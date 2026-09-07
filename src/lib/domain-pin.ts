/**
 * Exact-host-suffix match for site domain pinning. Replaces a previous
 * substring `.includes()` check that let `evil-acme.com` or
 * `acme.com.evil.tld` both pass as `acme.com`, and required the
 * Origin/Referer header to be present when a site declares a domain — an
 * empty header (trivial for any non-browser caller) used to skip the check
 * entirely.
 */
export function checkDomainPin(request: Request, registeredDomain: string | null): boolean {
  if (!registeredDomain) return true; // no pin configured for this site
  const originHeader = request.headers.get("origin") ?? request.headers.get("referer");
  if (!originHeader) return false; // caller must send Origin or Referer
  let host: string;
  try {
    host = new URL(originHeader).hostname.toLowerCase();
  } catch {
    return false;
  }
  const wanted = registeredDomain.toLowerCase().trim();
  return host === wanted || host.endsWith("." + wanted);
}
