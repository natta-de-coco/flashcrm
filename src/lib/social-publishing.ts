// What the Social Hub composer can honestly offer.
//
// QA, 26 Sep: the composer has no image or video upload (Instagram will not
// accept a caption on its own), no "Publish now", and no account picker.
//
// The reason there is no "Publish now" is that there is nothing for it to call.
// `saveSocialPost()` in src/lib/social.functions.ts writes a `social_posts` row
// with `status: "scheduled"` and stops, and no code anywhere reads
// `social_posts.status === "scheduled"` in order to send it — the only readers
// count it (src/lib/advisor.server.ts) or render it. There is no queue, no cron
// route and no per-platform publish call. Every social connector's `publish`
// capability in src/lib/social-connector-definitions.ts resolves to
// "not_implemented" or "not_supported" for exactly that reason.
//
// So the composer must not present scheduling as a delivery. It writes drafts,
// says so, and names the reason per platform. Adding a publishing pipeline is a
// separate piece of work; until it exists this module is the one place that
// says "no", so the UI cannot drift back into promising it.
//
// Pure functions with no imports: the logic is tested directly in
// tests/social-hub.test.mjs.

/**
 * Whether the Social Hub itself can send a saved post.
 *
 * Verified 2026-09-27: no code path reads a saved `social_posts` row and posts
 * it to any platform. Flip this only in the same change that adds one.
 */
export const SOCIAL_HUB_CAN_PUBLISH = false;

/**
 * Platforms whose API will not take a caption on its own. Flas has nowhere to
 * attach an image or video — `social_posts` stores a caption and counters and
 * no media reference at all — so these need that work before publishing is
 * even a question.
 */
export const MEDIA_FIRST_PLATFORMS: readonly string[] = [
  "instagram",
  "tiktok",
  "youtube",
  "pinterest",
];

export type PublishReality = {
  platform: string;
  displayName: string;
  /** True only when a saved post would really be sent. Always false today. */
  canPublishNow: boolean;
  /** True only when a dated post would really go out at that time. */
  canSchedule: boolean;
  /** One sentence for the UI, naming the actual reason. Never empty. */
  reason: string;
  /** True when this platform also needs media Flas cannot store. */
  needsMedia: boolean;
};

/**
 * The publishing truth for one platform.
 *
 * `publishStatus` is the status from
 * `resolveCapability(connectorDefinition(platform), "publish").status`, and
 * `missingScopes` that capability's missing scopes. Passing them in rather than
 * importing the registry keeps this module dependency-free and testable.
 */
export function publishReality(input: {
  platform: string;
  displayName: string;
  publishStatus: string | null;
  missingScopes?: readonly string[];
}): PublishReality {
  const { platform, displayName } = input;
  const needsMedia = MEDIA_FIRST_PLATFORMS.includes(platform);
  const providerCan = input.publishStatus !== "not_supported" && input.publishStatus !== null;
  const scopes = input.missingScopes ?? [];

  let reason: string;
  if (!providerCan) {
    reason = `${displayName} has no publishing API, so Flas cannot post there.`;
  } else if (input.publishStatus !== "implemented") {
    reason =
      `Flas cannot post to ${displayName}: nothing in Flas sends a saved post` +
      (scopes.length > 0 ? `, and it does not ask ${displayName} for ${scopes.join(" or ")}` : "") +
      ".";
  } else {
    // The registry says the connector can publish, but the Social Hub composer
    // still has no code that sends what it saves.
    reason = `Flas cannot post to ${displayName} from here: a saved post is never sent.`;
  }
  if (needsMedia) {
    reason += ` ${displayName} also needs an image or video, and a Flas post is caption text only.`;
  }

  const usable = SOCIAL_HUB_CAN_PUBLISH && input.publishStatus === "implemented";
  return {
    platform,
    displayName,
    canPublishNow: usable,
    canSchedule: usable,
    reason,
    needsMedia,
  };
}

/** What a saved, dated post really is, for the label next to the date field. */
export function plannedPostNote(canSchedule: boolean): string {
  return canSchedule
    ? "Flas will post this at the time you choose."
    : "Saved as a plan for your team. Flas will not post it for you.";
}
