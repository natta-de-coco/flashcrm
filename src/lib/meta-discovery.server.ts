// Meta connection discovery — finds every Page and Instagram account the
// authorizing user can actually reach, and explains precisely why a
// connection can't complete when it can't.
//
// This replaces a `data[0]` pick that silently chose whichever Page Meta
// happened to return first, and silently returned nothing when Instagram
// wasn't attached to that particular Page — even when Instagram WAS attached
// to a different Page the same user managed. That produced connected-but-
// empty accounts with no explanation, which is the single most common reason
// a Meta connection appears to "work" and then does nothing.
import { providerPages } from "./provider-pages.server";
import { normalizeProviderError, type NormalizedError } from "./integration-errors.server";

export const META_API_VERSION = "v21.0";
const GRAPH = `https://graph.facebook.com/${META_API_VERSION}`;

export type MetaPage = {
  id: string;
  name: string;
  username: string | null;
  category: string | null;
  picture: string | null;
  followers: number | null;
  profileUrl: string | null;
  /** Page-scoped token — required for most Page operations, not the user token. */
  pageAccessToken: string | null;
  /** Permissions this user holds ON this Page (CREATE_CONTENT, MANAGE, etc). */
  tasks: string[];
  instagram: MetaInstagramAccount | null;
};

export type MetaInstagramAccount = {
  id: string;
  username: string | null;
  name: string | null;
  picture: string | null;
  followers: number | null;
  biography: string | null;
  website: string | null;
};

export type MetaDiscovery = {
  ok: boolean;
  pages: MetaPage[];
  /** Pages that have an Instagram professional account attached. */
  pagesWithInstagram: MetaPage[];
  /** True when the user completed login but manages no Pages at all. */
  noPages: boolean;
  /** Plain-language explanation of what to do next, when something is wrong. */
  diagnosis: ConnectionDiagnosis | null;
  error: NormalizedError | null;
};

export type ConnectionDiagnosis = {
  title: string;
  message: string;
  /** Concrete, ordered things the person can actually go and do. */
  steps: string[];
  /** Where to go to fix it, when the fix lives on the platform's own site. */
  helpUrl: string | null;
};

/**
 * Lists every Page the token can reach, each with its attached Instagram
 * professional account (if any) and the caller's role on that Page.
 */
export async function discoverMetaTargets(token: string): Promise<MetaDiscovery> {
  const fields = [
    "id",
    "name",
    "username",
    "category",
    "link",
    "fan_count",
    "access_token",
    "tasks",
    "picture{url}",
    "instagram_business_account{id,username,name,profile_picture_url,biography,website,followers_count}",
  ].join(",");

  type AccountsResponse = { data?: Array<Record<string, unknown>>; error?: unknown };
  let json: AccountsResponse | null = null;
  let httpStatus: number | null = null;

  try {
    const data = await providerPages<Record<string, unknown>>({
      url: `${GRAPH}/me/accounts?fields=${fields}&limit=100`,
      token,
      items: "data",
      pagination: "meta",
    });
    httpStatus = 200;
    json = { data };
  } catch (thrown) {
    const error = normalizeProviderError({
      platform: "facebook",
      thrown,
      apiVersion: META_API_VERSION,
    });
    return { ok: false, pages: [], pagesWithInstagram: [], noPages: false, diagnosis: null, error };
  }

  if (!json || json.error || (httpStatus != null && httpStatus >= 400)) {
    const error = normalizeProviderError({
      platform: "facebook",
      httpStatus,
      body: json,
      apiVersion: META_API_VERSION,
    });
    return { ok: false, pages: [], pagesWithInstagram: [], noPages: false, diagnosis: null, error };
  }

  const pages: MetaPage[] = (json.data ?? []).map((raw: Record<string, unknown>) => {
    const p = raw as {
      id: string;
      name?: string;
      username?: string;
      category?: string;
      link?: string;
      fan_count?: number;
      access_token?: string;
      tasks?: string[];
      picture?: { data?: { url?: string }; url?: string };
      instagram_business_account?: {
        id: string;
        username?: string;
        name?: string;
        profile_picture_url?: string;
        biography?: string;
        website?: string;
        followers_count?: number;
      };
    };
    const ig = p.instagram_business_account;
    return {
      id: p.id,
      name: p.name ?? "(unnamed page)",
      username: p.username ?? null,
      category: p.category ?? null,
      picture: p.picture?.data?.url ?? p.picture?.url ?? null,
      followers: p.fan_count ?? null,
      profileUrl: p.link ?? (p.username ? `https://facebook.com/${p.username}` : null),
      pageAccessToken: p.access_token ?? null,
      tasks: p.tasks ?? [],
      instagram: ig
        ? {
            id: ig.id,
            username: ig.username ?? null,
            name: ig.name ?? null,
            picture: ig.profile_picture_url ?? null,
            followers: ig.followers_count ?? null,
            biography: ig.biography ?? null,
            website: ig.website ?? null,
          }
        : null,
    };
  });

  const pagesWithInstagram = pages.filter((p) => p.instagram !== null);

  return {
    ok: true,
    pages,
    pagesWithInstagram,
    noPages: pages.length === 0,
    diagnosis: null,
    error: null,
  };
}

/**
 * Turns a discovery result into an explanation for the platform the user is
 * actually trying to connect. Returns null when the connection can proceed.
 */
export function diagnoseMetaConnection(
  discovery: MetaDiscovery,
  platform: "facebook" | "instagram",
): ConnectionDiagnosis | null {
  if (!discovery.ok) {
    return {
      title: "Could not read your Facebook account",
      message:
        discovery.error?.friendlyMessage ??
        "Facebook did not return your Pages. The sign-in may not have completed correctly.",
      steps: ["Try connecting again.", "If it keeps failing, sign out of Facebook and retry."],
      helpUrl: null,
    };
  }

  if (discovery.noPages) {
    return {
      title: "No Facebook Page found",
      message:
        "You signed in successfully, but this Facebook account doesn't manage any Pages — and a Page is required. A personal Facebook profile can't be connected.",
      steps: [
        "Create a Facebook Page, or ask the Page owner to give you access.",
        "Make sure you granted access to the Page during sign-in — Facebook shows a Page list you have to tick.",
        "Then connect again.",
      ],
      helpUrl: "https://www.facebook.com/pages/create",
    };
  }

  if (platform === "facebook") {
    // Any Page is connectable; warn only if the user can't post to any of them.
    const canPublishSomewhere = discovery.pages.some((p) => p.tasks.includes("CREATE_CONTENT"));
    if (!canPublishSomewhere) {
      return {
        title: "Limited Page access",
        message:
          "Your Pages were found, but this Facebook account doesn't have content permission on any of them, so publishing won't work.",
        steps: [
          "Ask the Page owner to give you a role that can create content (Editor or above).",
          "Then reconnect.",
        ],
        helpUrl: "https://www.facebook.com/help/1206330326045914",
      };
    }
    return null;
  }

  // Instagram: the strict case — needs a professional account attached to a Page.
  if (discovery.pagesWithInstagram.length === 0) {
    return {
      title: "Instagram setup incomplete",
      message:
        "Facebook sign-in worked, but none of your Pages has an Instagram professional account attached — so there's nothing to connect yet.",
      steps: [
        "Make sure your Instagram account is a Business or Creator account, not personal.",
        "Link that Instagram account to one of your Facebook Pages.",
        "Re-run the connection and tick the Page it's linked to.",
      ],
      helpUrl: "https://help.instagram.com/570895513091465",
    };
  }

  return null;
}

/** True when the user must be asked which Page/account to connect (§8, §47). */
export function needsTargetSelection(
  discovery: MetaDiscovery,
  platform: "facebook" | "instagram",
): boolean {
  const relevant = platform === "instagram" ? discovery.pagesWithInstagram : discovery.pages;
  return relevant.length > 1;
}

/** The single obvious target when there's exactly one — no need to ask. */
export function soleTarget(
  discovery: MetaDiscovery,
  platform: "facebook" | "instagram",
): MetaPage | null {
  const relevant = platform === "instagram" ? discovery.pagesWithInstagram : discovery.pages;
  return relevant.length === 1 ? relevant[0]! : null;
}
