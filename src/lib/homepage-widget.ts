/**
 * Pure helpers for the chat widget on Flas's own marketing pages. Kept apart
 * from the server function so they can be tested without a database.
 */
import { hostMatchesPin } from "./domain-pin";

/**
 * Whether a registered site domain covers this host. The same rule as
 * checkDomainPin in domain-pin.ts, which the chat endpoint applies to every
 * message -- a site chosen here must also be one the endpoint will accept.
 */
export function domainCoversHost(domain: string | null, host: string): boolean {
  if (!domain) return false;
  return hostMatchesPin(host, domain);
}

export type OwnerSite = {
  site_key: string | null;
  domain: string | null;
  active: boolean;
  status: string;
  tenant_id: string | null;
  created_at: string;
};

/**
 * The site whose widget Flas's own pages should load for this host, or null.
 *
 * Only sites in a platform owner's workspace count. lead_sites.domain is not
 * unique, so any customer can register a site with domain
 * "flas.mobidigisol.com"; matching on domain alone would let them put their
 * own chat, and receive every visitor's name and WhatsApp number, on Flas's
 * homepage. A site with no domain is skipped for the same reason: it is not
 * pinned to this site at all.
 */
export function pickHomepageSite(
  sites: readonly OwnerSite[],
  ownerTenantIds: readonly string[],
  host: string,
): string | null {
  const owners = new Set(ownerTenantIds);
  const match = [...sites]
    .filter(
      (s) =>
        s.site_key &&
        s.tenant_id !== null &&
        owners.has(s.tenant_id) &&
        s.active &&
        s.status === "active" &&
        domainCoversHost(s.domain, host),
    )
    // Oldest first, so adding a second site never silently swaps the widget.
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  return match[0]?.site_key ?? null;
}
