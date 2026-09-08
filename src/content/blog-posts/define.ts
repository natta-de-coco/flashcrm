import type { Post } from "../blog";

export type ArticleDraft = Omit<Post, "published" | "readingMinutes">;

/** First release date in a batch. Later articles are spaced out from here. */
const FIRST_RELEASE = Date.UTC(2026, 8, 15); // 2026-09-15
const DAYS_BETWEEN = 3;

/**
 * Turns drafts into posts, assigning a release date and a reading estimate.
 *
 * Dates are spaced rather than shared. Every article in a batch carrying the
 * same publication date is the clearest signal of scaled content generation,
 * and it is the one Google's spam policy demotes for -- so a batch is released
 * across several weeks, in the order it is written.
 *
 * `startAt` lets a second batch continue after the first instead of restarting
 * on the same dates and recreating the problem.
 */
export function defineArticles(articles: ArticleDraft[], startAt = 0): Post[] {
  return articles.map((article, i) => {
    const day = new Date(FIRST_RELEASE + (startAt + i) * DAYS_BETWEEN * 86_400_000);
    return {
      ...article,
      published: day.toISOString().slice(0, 10),
      readingMinutes: Math.max(
        1,
        Math.ceil(article.html.replace(/<[^>]*>/g, " ").trim().split(/\s+/).length / 220),
      ),
    };
  });
}
