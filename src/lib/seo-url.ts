// SSRF protection for WordPress site URLs.

export function isSafeWordPressUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (host === "metadata.google.internal") return false;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 127) return false; // loopback
    if (a === 10) return false; // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return false; // RFC1918
    if (a === 192 && b === 168) return false; // RFC1918
    if (a === 169 && b === 254) return false; // link-local, incl. cloud metadata
    if (a === 0) return false;
  }
  const cleanHost = host.replace(/^\[|\]$/g, "");
  if (
    cleanHost === "::1" ||
    cleanHost.startsWith("fe80:") ||
    cleanHost.startsWith("fc") ||
    cleanHost.startsWith("fd")
  ) {
    return false;
  }

  return true;
}
