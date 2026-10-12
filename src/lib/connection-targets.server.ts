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
import { providerPages, ProviderPagesError } from "./provider-pages.server";
import { LINKEDIN_API_VERSION } from "@/lib/linkedin";

export type ConnectionTarget = {
  id: string;
  name: string;
  /** A second line for the picker: a vanity URL, an address. */
  detail: string | null;
  profileUrl: string | null;
};

export type TargetList =
  | { ok: true; targets: ConnectionTarget[] }
  | { ok: false; targets: []; reason: string; diagnostic?: string };

function targetListFailure(platform: string, error: unknown): TargetList {
  const diagnostic = error instanceof Error ? error.message : "The platform did not respond.";
  const providerReason = error instanceof ProviderPagesError ? error.providerReason : null;
  const providerStatus = error instanceof ProviderPagesError ? error.status : null;
  const safeDiagnostic = `YouTube channel discovery failed (HTTP ${providerStatus ?? "unknown"}; reason=${providerReason ?? "unknown"}).`;

  // Google returns 429 when the Business Profile API is enabled but the
  // project still has its default zero quota. Retrying OAuth cannot fix that:
  // an administrator must finish Google's one-time API access application.
  if (platform === "google_business" && /HTTP 429\b/.test(diagnostic)) {
    return {
      ok: false,
      targets: [],
      reason:
        "Google has not yet approved Business Profile API access for FLAS. An administrator must finish Google's one-time access application, then reconnect after Google grants quota.",
      diagnostic,
    };
  }

  if (platform === "google_business" && /HTTP 403\b/.test(diagnostic)) {
    return {
      ok: false,
      targets: [],
      reason:
        "Google Business Profile API access is not ready. An administrator must enable both Business Profile APIs and complete Google's one-time access application.",
      diagnostic,
    };
  }

  if (platform === "youtube") {
    // 1. YouTube Data API v3 not enabled in Google Cloud Console
    if (
      providerReason === "accessNotConfigured" ||
      providerReason === "SERVICE_DISABLED" ||
      /accessNotConfigured|SERVICE_DISABLED|has not been used in project/i.test(diagnostic)
    ) {
      return {
        ok: false,
        targets: [],
        reason:
          "YouTube Data API v3 is not enabled in the Google Cloud project. A FLAS administrator must enable YouTube Data API v3 in Google Cloud Console before connecting.",
        diagnostic: safeDiagnostic,
      };
    }

    // 2. YouTube Data API quota exceeded
    if (
      providerReason === "quotaExceeded" ||
      providerReason === "dailyLimitExceeded" ||
      providerReason === "rateLimitExceeded" ||
      /quotaExceeded|dailyLimitExceeded|rateLimitExceeded/i.test(diagnostic) ||
      /HTTP 429\b/.test(diagnostic)
    ) {
      return {
        ok: false,
        targets: [],
        reason:
          "YouTube API quota has been exceeded for this project. Please retry later or ask a FLAS administrator to request a quota increase from Google.",
        diagnostic: safeDiagnostic,
      };
    }

    // 3. Channel access permissions not granted by user during OAuth consent
    if (
      providerReason === "insufficientPermissions" ||
      providerReason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT" ||
      /insufficientPermissions/i.test(diagnostic)
    ) {
      return {
        ok: false,
        targets: [],
        reason:
          "This Google sign-in did not grant channel access permissions for YouTube. Reconnect and check the YouTube channel permissions on Google's consent screen.",
        diagnostic: safeDiagnostic,
      };
    }

    // 4. No active YouTube channel or sign-up required
    if (
      providerReason === "youtubeSignupRequired" ||
      providerReason === "channelNotFound" ||
      /youtubeSignupRequired|channelNotFound/i.test(diagnostic)
    ) {
      return {
        ok: false,
        targets: [],
        reason:
          "No active YouTube channel was found for this Google account. Open YouTube Studio to create a channel, or reconnect using the Brand Account that owns the channel.",
        diagnostic: safeDiagnostic,
      };
    }

    // 5. Generic HTTP 403 for YouTube
    if (
      /HTTP 403\b/.test(diagnostic) ||
      (error instanceof ProviderPagesError && error.status === 403)
    ) {
      return {
        ok: false,
        targets: [],
        reason:
          "Google refused access to your YouTube channels (HTTP 403). Verify YouTube Data API v3 is enabled in Google Cloud Console and that the signed-in account owns an active channel.",
        diagnostic: safeDiagnostic,
      };
    }
  }

  return { ok: false, targets: [], reason: diagnostic };
}

/** Platforms whose login can manage more than one channel, served by this module. */
export const TARGET_PLATFORMS = [
  "youtube",
  "linkedin",
  "google_business",
  "google_analytics",
  "search_console",
  "meta_ads",
] as const;

export function hasTargetDiscovery(platform: string): boolean {
  return (TARGET_PLATFORMS as readonly string[]).includes(platform);
}

export async function listConnectionTargets(platform: string, token: string): Promise<TargetList> {
  try {
    if (platform === "youtube") return await youtubeTargets(token);
    if (platform === "linkedin") return await linkedinTargets(token);
    if (platform === "google_business") return await businessProfileTargets(token);
    if (platform === "google_analytics") return await ga4Targets(token);
    if (platform === "search_console") return await searchConsoleTargets(token);
    if (platform === "meta_ads") return await metaAdAccountTargets(token);
  } catch (error) {
    return targetListFailure(platform, error);
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
  switch (platform) {
    case "youtube":
      return "No YouTube channel was returned for this sign-in. Connect again using the Google or Brand Account that owns the channel.";
    case "linkedin":
      return "This LinkedIn account is not an administrator of any Company Page. Ask a Page admin to add you as a Super admin or Content admin, then connect again.";
    case "google_business":
      return "No Business Profile location was found for this Google account. Check the account manages a verified location, and that Google has approved Business Profile API access for this app.";
    case "google_analytics":
      return "No GA4 property was found for this Google account. You need at least Viewer access to a GA4 property.";
    case "search_console":
      return "No verified Search Console site was found for this Google account. Verify the site in Search Console first.";
    case "meta_ads":
      return "No ad account was found for this Facebook login. You need a role on an ad account in Meta Business Manager.";
    default:
      return "This login does not manage anything Flas can connect.";
  }
}

async function linkedinTargets(token: string): Promise<TargetList> {
  const headers = {
    Authorization: `Bearer ${token}`,
    "LinkedIn-Version": LINKEDIN_API_VERSION,
    "X-Restli-Protocol-Version": "2.0.0",
  };
  // Posting and analytics act on a Page, and LinkedIn allows them only for
  // members with an approved ADMINISTRATOR role on it.
  const entries = await providerPages<{ organization?: string }>({
    url: "https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=50",
    token,
    items: "elements",
    pagination: "linkedin",
    headers,
  });
  const ids = [
    ...new Set<string>(
      entries
        .map((e) => String(e?.organization ?? ""))
        .filter((urn: string) => urn.startsWith("urn:li:organization:"))
        .map((urn: string) => urn.slice("urn:li:organization:".length)),
    ),
  ];

  const targets = await Promise.all(
    ids.map(async (id): Promise<ConnectionTarget> => {
      const r = await fetch(
        `https://api.linkedin.com/rest/organizations/${encodeURIComponent(id)}`,
        {
          headers,
        },
      );
      const org: { vanityName?: string; localizedName?: string } = r.ok
        ? await r.json().catch(() => ({}))
        : {};
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
  const accounts = await providerPages<{ name: string; accountName?: string }>({
    url: "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
    token,
    items: "accounts",
  });
  const targets: ConnectionTarget[] = [];
  for (const account of accounts) {
    if (!/^accounts\/[^/]+$/.test(account.name))
      throw new Error("Google returned an invalid account identifier.");
    const locations = await providerPages<{
      name: string;
      title?: string;
      storefrontAddress?: { addressLines?: string[]; locality?: string };
    }>({
      url: `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title,storefrontAddress&pageSize=100`,
      token,
      items: "locations",
    });
    for (const location of locations) {
      if (!/^locations\/[^/]+$/.test(location.name)) continue;
      targets.push({
        id: `${account.name}/${location.name}`,
        name: location.title ?? location.name,
        detail:
          location.storefrontAddress?.addressLines?.[0] ??
          location.storefrontAddress?.locality ??
          account.accountName ??
          null,
        profileUrl: null,
      });
    }
  }
  return { ok: true, targets };
}

async function ga4Targets(token: string): Promise<TargetList> {
  const summaries = await providerPages<{
    displayName?: string;
    propertySummaries?: { property: string; displayName?: string }[];
  }>({
    url: "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200",
    token,
    items: "accountSummaries",
  });
  const targets: ConnectionTarget[] = [];
  for (const account of summaries) {
    for (const property of account?.propertySummaries ?? []) {
      if (!property?.property) continue;
      targets.push({
        id: String(property.property),
        name: property.displayName ?? String(property.property),
        detail: account.displayName ?? null,
        profileUrl: null,
      });
    }
  }
  return { ok: true, targets };
}

async function searchConsoleTargets(token: string): Promise<TargetList> {
  const res = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json: { siteEntry?: { siteUrl?: string; permissionLevel?: string }[] } = await res
    .json()
    .catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      targets: [],
      reason: `Search Console refused to list your sites (HTTP ${res.status}).`,
    };
  }
  const LEVELS: Record<string, string> = {
    siteOwner: "Owner",
    siteFullUser: "Full user",
    siteRestrictedUser: "Restricted user",
  };
  const targets = (json?.siteEntry ?? [])
    // An unverified site returns no data; offering it would connect nothing.
    .filter((s) => s?.siteUrl && s.permissionLevel !== "siteUnverifiedUser")
    .map((s): ConnectionTarget => ({
      id: String(s.siteUrl),
      name: String(s.siteUrl).replace(/^sc-domain:/, ""),
      detail: LEVELS[String(s.permissionLevel)] ?? null,
      profileUrl: null,
    }));
  return { ok: true, targets };
}

async function metaAdAccountTargets(token: string): Promise<TargetList> {
  const accounts = await providerPages<{
    id: string;
    name?: string;
    currency?: string;
    account_status?: number;
  }>({
    url: "https://graph.facebook.com/v21.0/me/adaccounts?fields=id,name,currency,account_status&limit=100",
    token,
    items: "data",
    pagination: "meta",
  });
  const targets = accounts
    .filter((a) => a?.id)
    .map((a): ConnectionTarget => ({
      id: String(a.id),
      name: a.name ?? String(a.id),
      detail:
        [a.currency, a.account_status === 1 ? "active" : "not active"]
          .filter(Boolean)
          .join(" · ") || null,
      profileUrl: null,
    }));
  return { ok: true, targets };
}

async function youtubeTargets(token: string): Promise<TargetList> {
  // mine=true lists only channels authorized by this consent. It does not grant
  // FLAS access to every Brand Account owned by the signed-in Google user.
  const channels = await providerPages<{
    id: string;
    snippet?: { title?: string; customUrl?: string };
  }>({
    url: "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=50",
    token,
    items: "items",
  });
  return {
    ok: true,
    targets: channels
      .filter((ch) => ch.id)
      .map((ch) => ({
        id: ch.id,
        name: ch.snippet?.title ?? "YouTube channel",
        detail: ch.snippet?.customUrl ?? null,
        profileUrl: `https://www.youtube.com/channel/${encodeURIComponent(ch.id)}`,
      })),
  };
}
