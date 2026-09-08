import type { Post } from "../blog";

export type ArticleDraft = Omit<Post, "published" | "readingMinutes">;

/** Publication dates are real release dates, never backdated SEO signals. */
export function defineArticles(articles: ArticleDraft[]): Post[] {
  return articles.map((article) => ({
    ...article,
    published: "2026-09-08",
    readingMinutes: Math.max(
      1,
      Math.ceil(article.html.replace(/<[^>]*>/g, " ").trim().split(/\s+/).length / 220),
    ),
  }));
}
