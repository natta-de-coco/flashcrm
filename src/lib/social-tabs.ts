/*
 * The tabs of the Social posts screen, and which one a link or a reload opens.
 *
 * The tab lives in the address (`/social?tab=comments`), so Back, reload and a
 * pasted link keep it, and "Comments & DMs" and "Reach & audience" stay directly
 * linkable even though the screen now opens on writing a post.
 */
export const SOCIAL_TABS = ["write", "comments", "reach"] as const;
export type SocialTab = (typeof SOCIAL_TABS)[number];

/** Writing a post is what the screen is called, so it is what opens by default. */
export const DEFAULT_SOCIAL_TAB: SocialTab = "write";

/** A tab from the address; anything that is not one of the three is the writer. */
export function parseSocialTab(value: unknown): SocialTab {
  return typeof value === "string" && (SOCIAL_TABS as readonly string[]).includes(value)
    ? (value as SocialTab)
    : DEFAULT_SOCIAL_TAB;
}
