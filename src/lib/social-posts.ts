// Ordering, grouping and attribution for the Social Hub's post list.
//
// QA, 26 Sep: the list showed every post twice with no platform label or icon,
// so an Instagram post and the Facebook copy of the same caption were
// indistinguishable, and "6h ago" sat between "2d" and "59d".
//
// The order came from the query, which sorts `social_posts` by `created_at` —
// the moment the row was written by a sync, not the moment the post went out.
// A first sync writes decade-old posts in one pass, so `created_at` is close to
// identical for all of them and says nothing about the content. The date a
// reader means is `published_at` for a published post and `scheduled_at` for a
// planned one, which is what is used here.
//
// Pure functions with no imports: the logic is tested directly in
// tests/social-hub.test.mjs.

export type SortablePost = {
  id: string;
  account_id: string | null;
  status: string;
  published_at?: string | null;
  scheduled_at?: string | null;
  created_at?: string | null;
};

/** The date a reader means for this post, or null when it has none. */
export function postDateIso(post: SortablePost): string | null {
  return post.published_at ?? post.scheduled_at ?? post.created_at ?? null;
}

/** Milliseconds for sorting, or null for a post with no usable date. */
export function postSortValue(post: SortablePost): number | null {
  const iso = postDateIso(post);
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Newest first, by the post's own date. Undated posts keep their incoming order
 * at the end rather than being scattered through the list, and equal dates keep
 * their incoming order too — a stable sort, so the list does not reshuffle
 * between renders.
 */
export function sortPostsByDateDesc<T extends SortablePost>(posts: readonly T[]): T[] {
  return sortPosts(posts, "desc");
}

/** Soonest first — a planned post is read forwards, not backwards. */
export function sortPostsByDateAsc<T extends SortablePost>(posts: readonly T[]): T[] {
  return sortPosts(posts, "asc");
}

function sortPosts<T extends SortablePost>(posts: readonly T[], order: "asc" | "desc"): T[] {
  const direction = order === "desc" ? -1 : 1;
  return posts
    .map((post, index) => ({ post, index, value: postSortValue(post) }))
    .sort((a, b) => {
      // Undated posts go last in both directions: they are at the end of the
      // list, not at the top of it.
      if (a.value === null && b.value === null) return a.index - b.index;
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      if (a.value !== b.value) return direction * (a.value - b.value);
      return a.index - b.index;
    })
    .map((entry) => entry.post);
}

export type PostGroups<T> = {
  /** Saved with a date. Nothing in Flas sends these; see social-publishing.ts. */
  planned: T[];
  /** Saved with no date. */
  drafts: T[];
  /** Read back from the platform by a sync. */
  published: T[];
};

/**
 * Splits the list the three ways the UI shows it. A draft and a planned post
 * are editable; a published one was written on the platform and is only ever
 * read here.
 */
export function groupPostsByState<T extends SortablePost>(posts: readonly T[]): PostGroups<T> {
  const planned: T[] = [];
  const drafts: T[] = [];
  const published: T[] = [];
  for (const post of posts) {
    if (post.status === "published") published.push(post);
    else if (post.status === "scheduled") planned.push(post);
    else drafts.push(post);
  }
  return {
    planned: sortPostsByDateAsc(planned),
    drafts: sortPostsByDateDesc(drafts),
    published: sortPostsByDateDesc(published),
  };
}

/** True when this post can still be rewritten in Flas. */
export function isEditablePost(post: SortablePost): boolean {
  return post.status !== "published";
}

/**
 * Status wording.
 *
 * "Scheduled" is deliberately not used: nothing in Flas reads
 * `social_posts.status === "scheduled"` and sends it, so the word would promise
 * a delivery that never happens. See src/lib/social-publishing.ts.
 */
export function postStatusLabel(status: string): string {
  if (status === "published") return "Published";
  if (status === "scheduled") return "Planned";
  return "Draft";
}

export type AccountRef = { id: string; platform: string; label: string };

export type PostAttribution = {
  /** The platform id, or null when the post is attached to no known account. */
  platform: string | null;
  /** What to print on the badge. Never empty. */
  label: string;
  /** False when the row points at no account, or at one that is gone. */
  attached: boolean;
};

/**
 * Which account a post belongs to.
 *
 * A post saved by the composer before any account was connected has
 * `account_id: null`, and a post whose account was deleted points at a row that
 * is no longer there. Both are named rather than silently blank.
 */
export function postAttribution(
  post: { account_id: string | null },
  accounts: readonly AccountRef[],
): PostAttribution {
  if (!post.account_id) return { platform: null, label: "No account", attached: false };
  const account = accounts.find((a) => a.id === post.account_id);
  if (!account) return { platform: null, label: "Account removed", attached: false };
  return { platform: account.platform, label: account.label, attached: true };
}

/**
 * Last-resort display name for a stored platform id the UI has no entry for.
 * Used instead of falling back to the first platform in a list, which is how
 * the Social Hub came to show the Instagram icon for every platform it did not
 * recognise.
 */
export function humanizePlatformId(platform: string): string {
  return platform
    .split(/[_-]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
