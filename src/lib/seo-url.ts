// SSRF protection and canonical redirect security for WordPress site URLs.
import dns from "node:dns/promises";

export function isPrivateIpv4(a: number, b: number, c: number, d: number): boolean {
  if (a === 0) return true; // "this" network
  if (a === 127) return true; // loopback
  if (a === 10) return true; // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier NAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

export function isPrivateIpAddress(rawIp: string): boolean {
  const clean = (rawIp ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");
  if (!clean) return true;

  // IPv4 check
  const ipv4 = clean.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b, c, d] = [Number(ipv4[1]), Number(ipv4[2]), Number(ipv4[3]), Number(ipv4[4])];
    if (a > 255 || b > 255 || c > 255 || d > 255) return true;
    return isPrivateIpv4(a, b, c, d);
  }

  // IPv6 loopback, unspecified
  if (
    clean === "::1" ||
    clean === "::" ||
    clean === "0:0:0:0:0:0:0:1" ||
    clean === "0:0:0:0:0:0:0:0"
  ) {
    return true;
  }

  // Link-local fe80::/10, unique-local fc00::/7 (fc00:: - fdff::)
  if (/^(fe[89ab]|fc|fd)/i.test(clean)) {
    return true;
  }

  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
  const mappedDotted = clean.match(/(?:^|:)ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i);
  if (mappedDotted) {
    const [a, b, c, d] = [
      Number(mappedDotted[1]),
      Number(mappedDotted[2]),
      Number(mappedDotted[3]),
      Number(mappedDotted[4]),
    ];
    if (a > 255 || b > 255 || c > 255 || d > 255) return true;
    return isPrivateIpv4(a, b, c, d);
  }

  const mappedHex = clean.match(/(?:^|:)(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (
    mappedHex &&
    mappedHex[1] &&
    mappedHex[2] &&
    (clean.startsWith("::") || /:ffff:/i.test(clean))
  ) {
    const high = parseInt(mappedHex[1], 16);
    const low = parseInt(mappedHex[2], 16);
    const a = (high >> 8) & 0xff;
    const b = high & 0xff;
    const c = (low >> 8) & 0xff;
    const d = low & 0xff;
    return isPrivateIpv4(a, b, c, d);
  }

  // IPv4-compatible IPv6 (e.g. ::127.0.0.1)
  const compatDotted = clean.match(/^::(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (compatDotted) {
    const [a, b, c, d] = [
      Number(compatDotted[1]),
      Number(compatDotted[2]),
      Number(compatDotted[3]),
      Number(compatDotted[4]),
    ];
    if (a > 255 || b > 255 || c > 255 || d > 255) return true;
    return isPrivateIpv4(a, b, c, d);
  }

  // Generic unspecified/multicast/private IPv6 prefixes
  if (clean.startsWith("::") && !clean.startsWith("::ffff:")) {
    return true;
  }

  return false;
}

export function isSafeWordPressUrl(raw: string): boolean {
  let url: URL;
  try {
    const trimmed = (raw ?? "").trim();
    if (!trimmed) return false;
    let candidate = trimmed;
    // If it does not specify a protocol scheme, default to https
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
      candidate = `https://${trimmed}`;
    }
    url = new URL(candidate);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password) return false;

  // Strip trailing dot to prevent trailing-dot bypasses (e.g. "localhost.", "metadata.google.internal.")
  const rawHost = url.hostname.toLowerCase();
  const host = rawHost.replace(/\.+$/, "");
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan")
  ) {
    return false;
  }
  if (host === "metadata.google.internal") return false;

  // Reject pure numeric/decimal IPs (e.g. 2130706433)
  if (/^\d+$/.test(host)) return false;

  if (isPrivateIpAddress(host)) {
    return false;
  }

  return true;
}

/**
 * Verifies whether a redirect target URL is strictly same-origin or a canonical
 * subdomain (e.g. www <-> non-www on the exact same base domain) over HTTPS.
 * Never allows downgrades to plaintext HTTP or re-authenticating across distinct domains.
 */
export function isSameCanonicalOrigin(targetUrl: string, originalUrl: string): boolean {
  try {
    const target = new URL(targetUrl);
    const orig = new URL(originalUrl);
    if (target.protocol !== "https:") return false;
    if (target.port !== orig.port) return false;
    const tHost = target.hostname.toLowerCase().replace(/\.+$/, "");
    const oHost = orig.hostname.toLowerCase().replace(/\.+$/, "");
    if (tHost === oHost) return true;
    if (tHost === `www.${oHost}` || oHost === `www.${tHost}`) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Resolves a host/URL via DNS and verifies that none of its resolved A/AAAA addresses
 * point to private, loopback, or link-local ranges (DNS anti-rebinding protection).
 */
export async function assertSafeDnsHost(hostOrUrl: string): Promise<void> {
  let hostname = hostOrUrl;
  if (hostOrUrl.includes("://")) {
    try {
      hostname = new URL(hostOrUrl).hostname;
    } catch {
      // keep as-is
    }
  }
  const cleanHost = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");
  if (!cleanHost) {
    throw new Error("Invalid or empty host.");
  }

  if (
    cleanHost === "localhost" ||
    cleanHost.endsWith(".localhost") ||
    cleanHost.endsWith(".local") ||
    cleanHost.endsWith(".internal") ||
    cleanHost.endsWith(".lan") ||
    cleanHost === "metadata.google.internal"
  ) {
    throw new Error(`Security violation: ${cleanHost} is a restricted hostname.`);
  }

  if (isPrivateIpAddress(cleanHost)) {
    throw new Error(`Security violation: ${cleanHost} is a restricted/private network address.`);
  }

  // If pure numeric IPv4, isPrivateIpAddress already validated it
  if (/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(cleanHost)) {
    return;
  }

  try {
    const records = await dns.lookup(cleanHost, { all: true });
    if (!records || records.length === 0) {
      throw new Error(`DNS resolution failed for ${cleanHost}: no records found.`);
    }
    for (const record of records) {
      if (isPrivateIpAddress(record.address)) {
        throw new Error(
          `Security violation: ${cleanHost} resolves to restricted/private IP (${record.address}). Access denied.`,
        );
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Security violation:")) {
      throw err;
    }
    throw new Error(
      `DNS lookup failed for ${cleanHost}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
