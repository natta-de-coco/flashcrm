/*
 * The channels one login can manage, for platforms where the login is not the
 * channel itself: a LinkedIn member administers Company Pages, and a Google
 * account manages Business Profile locations. Meta has its own discovery in
 * meta-discovery.server.ts, because Page tokens come with it.
 *
 * Discovery always runs server-side, against the provider, with the token Flas
 * holds. An id submitted by a browser is accepted only if it appears in this
 * list -- that is what stops anyone connecting a channel they do not manage.
 *
 * Before this, discovery kept a channel only when the login had exactly one;
 * with two or more the connection was saved with no channel at all, and sync
 * then stopped at "add your ID" with nowhere to add it.
 */
import { LINKEDIN_API_VERSION } from "@/lib/linkedin";

export type ConnectionTarget = {
  id: string;
  name: string;
  /** A second line for the picker: a vanity URL, an address. */
  detail: string | null;
  profileUrl: string | null;
};

export type TargetList =
  { ok: true; targets: ConnectionTarget[] } | { ok: false; targets: []; reason: string };

/** Platforms whose login can manage more than one channel, served by this module. */
export const TARGET_PLATFORMS = ["linkedin", "google_business"] as const;

export function hasTargetDiscovery(platform: string): boolean {
  return (TARGET_PLATFORMS as readonly string[]).includes(platform);
}

export async function listConnectionTargets(platform: string, token: string): Promise<TargetList> {
  try {
    if (platform === "linkedin") return await linkedinTargets(token);
    if (platform === "google_business") return await businessProfileTargets(token);
  } catch (error) {
    return {
      ok: false,
      targets: [],
      reason: error instanceof Error ? error.message : "The platform did not respond.",
    };
  }
  return { ok: false, targets: [], reason: "This platform has no account picker." };
}

/** The chosen target, if and only if this login can manage it. */
export function pickTarget(list: ConnectionTarget[], targetId: string): ConnectionTarget | null {
  return list.find((t) => t.id === targetId) ?? null;
}

/** The fields a connection row stores for a chosen target. */
export function targetProfile(target: ConnectionTarget): {
  external_id: string;
  name: string;
  profile_url: string | undefined;
} {
  return {
    external_id: target.id,
    name: target.name,
    profile_url: target.profileUrl ?? undefined,
  };
}

/** What to tell the customer when a login manages nothing Flas can connect. */
export function noTargetReason(platform: string): string {
  return platform === "linkedin"
    ? "This LinkedIn account is not an administrator of any Company Page. Ask a Page admin to add you as a Super admin or Content admin, then connect again."
    : "No Business Profile location was found for this Google account. Check the account manages a verified location, and that Google has approved Business Profile API access for this app.";
}

async function linkedinTargets(token: string): Promise<TargetList> {
  const headers = {
    Authorization: `Bearer ${token}`,
    "LinkedIn-Version": LINKEDIN_API_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
  };
  // Posting and analytics act on a Page, and LinkedIn allows them only for
  // members with an approved ADMINISTRATOR role on it.
  const res = await fetch(
    "https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=50",
    { headers },
  );
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      targets: [],
      reason: `LinkedIn refused to list your Company Pages (HTTP ${res.status}). The Flas LinkedIn app may not have Community Management API access yet.`,
    };
  }
  const ids = [
    ...new Set<string>(
      (json?.elements ?? [])
        .map((e: any) => String(e?.organization ?? ""))
        .filter((urn: string) => urn.startsWith("urn:li:organization:"))
        .map((urn: string) => urn.slice("urn:li:organization:".length)),
    ),
  ].slice(0, 25);

  const targets = await Promise.all(
    ids.map(async (id): Promise<ConnectionTarget> => {
      const r = await fetch(
        `https://api.linkedin.com/rest/organizations/${encodeURIComponent(id)}`,
        {
          headers,
        },
      );
      const org: any = r.ok ? await r.json().catch(() => ({})) : {};
      const vanity = typeof org?.vanityName === "string" ? org.vanityName : null;
      return {
        id,
        // A name lookup that fails still leaves a usable, honest label.
        name: typeof org?.localizedName === "string" ? org.localizedName : `Company Page ${id}`,
        detail: vanity ? `linkedin.com/company/${vanity}` : null,
        profileUrl: `https://www.linkedin.com/company/${vanity ?? id}/`,
      };
    }),
  );
  return { ok: true, targets };
}

async function businessProfileTargets(token: string): Promise<TargetList> {
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const accountsRes = await fetch(
    "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
    auth,
  );
  const accountsJson: any = await accountsRes.json().catch(() => ({}));
  if (!accountsRes.ok) {
    return {
      ok: false,
      targets: [],
      // Google answers 429 (quota 0) or 403 until it approves API access.
      reason:
        accountsRes.status === 429 || accountsRes.status === 403
          ? "Google refused the Business Profile request. Google must approve Business Profile API access for this app before its locations can be listed."
          : `Google refused to list your Business Profile accounts (HTTP ${accountsRes.status}).`,
    };
  }

  const targets: ConnectionTarget[] = [];
  for (const account of (accountsJson?.accounts ?? []).slice(0, 10)) {
    const accountName = String(account?.name ?? "");
    if (!accountName) continue;
    const locRes = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=name,title,storefrontAddress&pageSize=100`,
      auth,
    );
    const locJson: any = await locRes.json().catch(() => ({}));
    for (const location of locJson?.locations ?? []) {
      if (!location?.name) continue;
      const address =
        location.storefrontAddress?.addressLines?.[0] ??
        location.storefrontAddress?.locality ??
        null;
      targets.push({
        // The path reviews are read from: accounts/{a}/locations/{l}.
        id: `${accountName}/${location.name}`,
        name: location.title ?? location.name,
        detail: address ?? account.accountName ?? null,
        profileUrl: null,
      });
    }
  }
  return { ok: true, targets };
}
