/**
 * The host name a site is known by, from whatever the site reported for itself.
 *
 * The WordPress plugin reports `home_url()` ("https://shop.example/blog") and
 * the popup reports `window.location.origin` ("https://shop.example"); an
 * admin may type just "shop.example". All of them are the same site, so the
 * pin compares only the host name: scheme, port, folder, query, upper case, a
 * trailing dot and one leading "www." are all ignored. A leading "www." is
 * ignored on both sides because "shop.example" and "www.shop.example" are the
 * same site to its visitors, and a site's home address may be either.
 *
 * Returns null for anything that is not a usable host name (empty, a path, an
 * address that does not parse, an IP literal), so the caller can refuse.
 */
export function siteHostname(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  // A path ("/blog") or "//host" is not an address a site reported.
  if (!text || text.startsWith("/")) return null;
  let url: URL;
  try {
    url = new URL(text.includes("://") ? text : `https://${text}`);
  } catch {
    return null;
  }
  let host = url.hostname.toLowerCase();
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host.startsWith("www.")) host = host.slice(4);
  return host && /^[a-z0-9.-]+$/.test(host) ? host : null;
}

/**
 * Whether `host` is the site registered as `registeredDomain`, or one of its
 * sub-domains. `registeredDomain` may be a host name or a full address (see
 * siteHostname); a registered value that cannot be read never matches.
 *
 * Exact-suffix, not substring: `evil-acme.com` and `acme.com.evil.tld` must
 * not pass as `acme.com`.
 */
export function hostMatchesPin(host: string, registeredDomain: string | null | undefined): boolean {
  const wanted = siteHostname(registeredDomain);
  const have = siteHostname(host);
  if (!wanted || !have) return false;
  return have === wanted || have.endsWith("." + wanted);
}

/**
 * Exact-host-suffix match for site domain pinning. Replaces a previous
 * substring `.includes()` check that let `evil-acme.com` or
 * `acme.com.evil.tld` both pass as `acme.com`, and required the
 * Origin/Referer header to be present when a site declares a domain — an
 * empty header (trivial for any non-browser caller) used to skip the check
 * entirely.
 *
 * The registered value is read with siteHostname, so a site stored as a full
 * address ("https://shop.example/blog") is pinned to its host name. A value
 * that cannot be read refuses every request rather than letting it through.
 */
export function checkDomainPin(request: Request, registeredDomain: string | null): boolean {
  if (!registeredDomain) return true; // no pin configured for this site
  const originHeader = request.headers.get("origin") ?? request.headers.get("referer");
  if (!originHeader) return false; // caller must send Origin or Referer
  let host: string;
  try {
    host = new URL(originHeader).hostname;
  } catch {
    return false;
  }
  return hostMatchesPin(host, registeredDomain);
}
