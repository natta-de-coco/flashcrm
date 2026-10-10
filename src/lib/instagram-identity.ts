// Is the id stored on an Instagram connection really an Instagram account?
//
// QA, 26 Sep: after a sync the Instagram card showed 3,405 followers — exactly
// the Facebook Page's number. The Instagram sync asks Meta for
// `/{external_id}?fields=followers_count` and writes whatever comes back as the
// Instagram account's followers. A Facebook Page node answers that same field
// with the Page's followers, so an Instagram row pinned to a Page id produces a
// Facebook number under an Instagram label, with nothing in the product saying
// so.
//
// Every current writer stores the Instagram Business Account id (the IGSID):
// connections.server.ts discoverProfile() uses `instagram_business_account.id`,
// and social-doctor.functions.ts selectMetaTarget() stores
// `page.instagram?.id`. A row holding a Page id therefore comes from outside
// those paths — the legacy hand-pasted "IG user ID" field, or a row edited
// directly — which is exactly the case the sync must refuse instead of
// inventing a follower count.
//
// The check cannot be done on the id's shape alone: Page ids and IGSIDs are
// both plain digit strings. So the decisive signal is Meta's own answer. Asking
// for `media_count`, which only an Instagram user node has, makes the Graph API
// name the node type in its error ("... on node type (Page)"), and that is what
// is read here.

/** The node types Meta uses for an Instagram account. */
const INSTAGRAM_NODE_TYPES = [/^ig/i, /instagram/i];

export type InstagramIdentity =
  /** Meta confirmed an Instagram account. Its own numbers are safe to store. */
  | { kind: "instagram"; followers: number | null; username: string | null }
  /**
   * The stored id is provably not an Instagram account. The sync must stop:
   * anything read with this id belongs to a different account.
   */
  | { kind: "wrong_account"; nodeType: string | null; message: string }
  /**
   * Meta did not answer clearly enough to tell either way — usually a missing
   * permission or an expired token. Nothing is stored, and the reason is
   * reported as a skipped section rather than guessed at.
   */
  | { kind: "unconfirmed"; message: string };

/**
 * Graph node ids are digit strings. A handle, a URL or a Business Profile
 * location path ("accounts/1/locations/2") is not an id at all, so it can be
 * rejected before a single call is made.
 */
export function isMetaNodeId(value: string | null | undefined): boolean {
  return typeof value === "string" && /^[0-9]{1,32}$/.test(value.trim());
}

/**
 * The node type Meta names when a requested field does not exist on the object
 * that id points at: "(#100) Tried accessing nonexisting field (media_count)
 * on node type (Page)" → "Page".
 */
export function metaErrorNodeType(message: string | null | undefined): string | null {
  if (typeof message !== "string") return null;
  const match = /on node type \(([^)]{1,60})\)/i.exec(message);
  return match?.[1]?.trim() ?? null;
}

/** True when the node type Meta named is one of Instagram's own. */
export function isInstagramNodeType(nodeType: string | null | undefined): boolean {
  if (typeof nodeType !== "string" || nodeType.trim() === "") return false;
  return INSTAGRAM_NODE_TYPES.some((pattern) => pattern.test(nodeType.trim()));
}

/** What to tell the person, naming what the connection is actually pinned to. */
export function wrongAccountMessage(nodeType: string | null): string {
  const what = nodeType
    ? `a Facebook ${nodeType}, not an Instagram account`
    : "an account Flas could not confirm is on Instagram";
  return (
    `This Instagram connection is pinned to ${what}, so its posts and follower count would be ` +
    `another account's. Reconnect Instagram under Connect & setup and pick the Instagram ` +
    `account attached to your Page.`
  );
}

/**
 * Reads Meta's answer to `/{id}?fields=id,username,followers_count,media_count`
 * and says whether the id is safe to attribute to an Instagram account.
 *
 * `profile` is the parsed success body, `errorMessage` the message of whatever
 * the call threw. Exactly one of the two is expected.
 */
export function readInstagramIdentity(input: {
  storedId: string | null | undefined;
  profile?: Record<string, unknown> | null;
  errorMessage?: string | null;
}): InstagramIdentity {
  const storedId = typeof input.storedId === "string" ? input.storedId.trim() : "";
  if (storedId === "") {
    return {
      kind: "wrong_account",
      nodeType: null,
      message: wrongAccountMessage(null),
    };
  }
  // Not a Graph id at all — a handle or a path pasted into the old ID field.
  if (!isMetaNodeId(storedId)) {
    return {
      kind: "wrong_account",
      nodeType: null,
      message:
        `"${storedId}" is not an Instagram account ID. Reconnect Instagram under Connect & setup ` +
        `and pick the Instagram account attached to your Page.`,
    };
  }

  const errorMessage = typeof input.errorMessage === "string" ? input.errorMessage.trim() : "";
  if (errorMessage !== "") {
    const nodeType = metaErrorNodeType(errorMessage);
    // Meta named the object this id points at. If it is not an Instagram node,
    // that is proof, not a guess.
    if (nodeType && !isInstagramNodeType(nodeType)) {
      return { kind: "wrong_account", nodeType, message: wrongAccountMessage(nodeType) };
    }
    // Anything else — a missing permission, an expired token, a field rename —
    // leaves the question open. Nothing is stored.
    return { kind: "unconfirmed", message: errorMessage };
  }

  const profile = input.profile ?? null;
  if (!profile) {
    return { kind: "unconfirmed", message: "Meta returned no profile for this account." };
  }
  const mediaCount = profile["media_count"];
  const followers = profile["followers_count"];
  const username = typeof profile["username"] === "string" ? profile["username"] : null;
  // `media_count` exists only on an Instagram user node. Its absence from a
  // successful reply is not proof of the wrong account (Meta can drop a field),
  // so it downgrades to "unconfirmed" and the sync stops: no number, post or
  // comment is written under an id that is not confirmed.
  if (typeof mediaCount !== "number") {
    return {
      kind: "unconfirmed",
      message:
        "Meta answered without media_count, so Flas could not confirm this id is an Instagram " +
        "account, so nothing was synced from it.",
    };
  }
  return {
    kind: "instagram",
    followers: typeof followers === "number" ? followers : null,
    username,
  };
}
