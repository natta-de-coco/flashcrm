// What a sync could not read, in words the person who has to fix it can act on.
//
// Each risky section of a Meta sync was wrapped in a bare `catch {}` and the
// sync still returned ok, so a Page connected without `pages_messaging`, or an
// Instagram account without `instagram_manage_comments`, reported "synced
// successfully, 0 interactions". That is the "it says it's connected but nothing
// happens" complaint, with the diagnosis thrown away.

export type SkippedSection = {
  /** What could not be read, named the way the product names it. */
  what: string;
  /** Why, in one sentence a workspace admin can act on. */
  reason: string;
};

/** The permission behind each thing a sync reads, for when Meta refuses it. */
const PERMISSION_FOR: Record<string, string> = {
  "Instagram comments": "instagram_manage_comments",
  "Instagram insights": "instagram_manage_insights",
  "Instagram profile": "instagram_basic",
  "Facebook comments": "pages_read_user_content",
  "Messenger conversations": "pages_messaging",
  "Facebook page details": "pages_read_engagement",
};

/**
 * Turns a provider error into a sentence that names the cause.
 *
 * Meta answers a missing permission with a message that already says which one
 * ("(#200) Requires instagram_manage_comments permission"), so when it does,
 * that is what the person needs to read. Everything else is reported as-is
 * rather than guessed at.
 */
export function skipReason(what: string, error: unknown): string {
  // Read `message` off whatever was thrown rather than testing `instanceof
  // Error`: a provider error can be a plain object, and an Error crossing a
  // module or worker boundary fails that test even though it has a message.
  const message = (error as { message?: unknown } | null | undefined)?.message;
  const text = (
    typeof message === "string" ? message : typeof error === "string" ? error : ""
  ).trim();
  const permission = PERMISSION_FOR[what];

  // Meta names the permission itself in a #200 / #10 error.
  const named = /\b([a-z_]*(?:manage|read|show|basic|messaging|publish)[a-z_]*)\b/.exec(text);
  if (/permission/i.test(text) && named) {
    return `Meta refused it: the connection is missing ${named[1]}. Reconnect and leave every permission ticked — this one may also need Meta's app review.`;
  }
  if (/expired|session has been invalidated|OAuthException/i.test(text)) {
    return "The access token is no longer valid. Reconnect this account.";
  }
  if (/rate limit|too many calls|#4\b|#17\b|#80001/i.test(text)) {
    return "Meta is rate-limiting this Page right now. It will work again shortly.";
  }
  if (text) {
    return permission
      ? `Meta refused it (${text}). This usually means the connection is missing ${permission}.`
      : `Meta refused it: ${text}`;
  }
  return permission
    ? `Meta refused it without saying why. This usually means the connection is missing ${permission}.`
    : "Meta refused it without saying why.";
}

/**
 * What to tell the person after a sync.
 *
 * A sync that read the posts but not the comments is not a success, and saying
 * so is the only way the workspace learns which permission is missing.
 */
export function syncSummary(result: {
  ok: boolean;
  posts: number;
  interactions: number;
  error?: string | undefined;
  skipped?: SkippedSection[] | undefined;
}): { tone: "success" | "warning" | "error"; text: string; detail?: string } {
  if (!result.ok) {
    return { tone: "error", text: result.error ?? "Sync failed" };
  }

  const counted = `${result.posts} ${plural(result.posts, "post")} and ${result.interactions} ${plural(
    result.interactions,
    "comment/DM",
  )}`;
  const skipped = result.skipped ?? [];
  if (skipped.length === 0) {
    return { tone: "success", text: `Synced ${counted}` };
  }

  return {
    tone: "warning",
    text: `Synced ${counted} — ${listOf(skipped.map((s) => s.what))} could not be read`,
    detail: skipped.map((s) => `${s.what}: ${s.reason}`).join(" "),
  };
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

/** "comments", "comments and DMs", "comments, DMs and insights" */
function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
