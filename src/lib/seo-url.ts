// SSRF protection for WordPress site URLs.

function isPrivateIpv4(a: number, b: number, c: number, d: number): boolean {
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

export function isSafeWordPressUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password) return false;

  const host = url.hostname.toLowerCase();
  if (
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

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b, c, d] = [Number(ipv4[1]), Number(ipv4[2]), Number(ipv4[3]), Number(ipv4[4])];
    if (isPrivateIpv4(a, b, c, d)) return false;
  }

  const cleanHost = host.replace(/^\[|\]$/g, "");
  // IPv6 loopback, unspecified, link-local, or unique-local
  if (
    cleanHost === "::1" ||
    cleanHost === "::" ||
    cleanHost === "0:0:0:0:0:0:0:1" ||
    cleanHost === "0:0:0:0:0:0:0:0" ||
    (cleanHost.startsWith("::") && !cleanHost.toLowerCase().startsWith("::ffff:")) ||
    /^(fe[89ab]|fc|fd)/i.test(cleanHost)
  ) {
    return false;
  }

  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
  const mappedDotted = cleanHost.match(
    /(?:^|:)ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i,
  );
  if (mappedDotted) {
    const [a, b, c, d] = [
      Number(mappedDotted[1]),
      Number(mappedDotted[2]),
      Number(mappedDotted[3]),
      Number(mappedDotted[4]),
    ];
    if (isPrivateIpv4(a, b, c, d)) return false;
  }

  const mappedHex = cleanHost.match(/(?:^|:)(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (mappedHex && mappedHex[1] && mappedHex[2] && (cleanHost.startsWith("::") || /:ffff:/i.test(cleanHost))) {
    const high = parseInt(mappedHex[1], 16);
    const low = parseInt(mappedHex[2], 16);
    const a = (high >> 8) & 0xff;
    const b = high & 0xff;
    const c = (low >> 8) & 0xff;
    const d = low & 0xff;
    if (isPrivateIpv4(a, b, c, d)) return false;
  }

  // IPv4-compatible IPv6 (e.g. ::127.0.0.1)
  const compatDotted = cleanHost.match(/^::(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (compatDotted) {
    const [a, b, c, d] = [
      Number(compatDotted[1]),
      Number(compatDotted[2]),
      Number(compatDotted[3]),
      Number(compatDotted[4]),
    ];
    if (isPrivateIpv4(a, b, c, d)) return false;
  }

  return true;
}
