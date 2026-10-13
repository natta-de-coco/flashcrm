// Verifies the marketing blog content integrity for SEO and sitemap generation.
// Ensures all posts have valid metadata, unique slugs, historical publication dates,
// and that all internal blog links point to actual existing articles.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("node_modules/.cache", { recursive: true });
buildSync({
  entryPoints: ["src/content/blog.ts"],
  outfile: "node_modules/.cache/flas-blog-bundle.mjs",
  format: "esm",
  platform: "node",
  bundle: true,
  logLevel: "error",
});

const { POSTS, POSTS_BY_DATE, findPost, CATEGORIES } =
  await import("../node_modules/.cache/flas-blog-bundle.mjs");

describe("marketing blog content and SEO integrity", () => {
  test("exports a healthy library of high-value guides", () => {
    // 9 CORE + 7 batches of 10 = 79 articles
    assert.ok(POSTS.length >= 70, `Expected at least 70 articles, got ${POSTS.length}`);
  });

  test("every article has unique slug and valid structure", () => {
    const slugs = new Set();
    const today = new Date().toISOString().slice(0, 10);

    for (const post of POSTS) {
      assert.ok(post.slug, `Post must have slug: ${JSON.stringify(post)}`);
      assert.ok(!slugs.has(post.slug), `Duplicate slug detected: ${post.slug}`);
      slugs.add(post.slug);

      assert.ok(post.title && post.title.trim().length > 10, `Title too short for ${post.slug}`);
      assert.ok(
        post.excerpt && post.excerpt.trim().length > 20,
        `Excerpt too short for ${post.slug}`,
      );
      assert.ok(
        post.category && post.category.trim().length > 0,
        `Missing category for ${post.slug}`,
      );
      assert.ok(
        Array.isArray(post.keywords) && post.keywords.length >= 2,
        `Keywords missing for ${post.slug}`,
      );
      assert.ok(post.readingMinutes >= 1, `Invalid reading minutes for ${post.slug}`);
      assert.ok(
        post.html && post.html.includes("<h2>"),
        `Article ${post.slug} must contain <h2> headings`,
      );

      // Date check: publication dates must not be in the future
      assert.match(post.published, /^\d{4}-\d{2}-\d{2}$/, `Date format invalid for ${post.slug}`);
      assert.ok(
        post.published <= today,
        `Post ${post.slug} has future published date: ${post.published}`,
      );
    }
  });

  test("POSTS_BY_DATE is sorted descending by publication date", () => {
    assert.equal(POSTS_BY_DATE.length, POSTS.length);
    for (let i = 1; i < POSTS_BY_DATE.length; i++) {
      assert.ok(
        POSTS_BY_DATE[i - 1].published >= POSTS_BY_DATE[i].published,
        `Out of order: ${POSTS_BY_DATE[i - 1].published} should be >= ${POSTS_BY_DATE[i].published}`,
      );
    }
  });

  test("findPost resolves all published articles", () => {
    for (const post of POSTS) {
      const found = findPost(post.slug);
      assert.equal(found?.slug, post.slug);
      assert.equal(found?.title, post.title);
    }
    assert.equal(findPost("non-existent-slug-xyz"), undefined);
  });

  test("all internal blog links resolve to existing posts", () => {
    const slugSet = new Set(POSTS.map((p) => p.slug));
    const internalLinkRegex = /href="\/blog\/([a-zA-Z0-9_-]+)"/g;

    for (const post of POSTS) {
      let match;
      while ((match = internalLinkRegex.exec(post.html)) !== null) {
        const targetSlug = match[1];
        assert.ok(
          slugSet.has(targetSlug),
          `Article "${post.slug}" links to non-existent blog post: "/blog/${targetSlug}"`,
        );
      }
    }
  });

  test("categories are populated", () => {
    assert.ok(CATEGORIES.length >= 5, `Expected multiple categories, got ${CATEGORIES.length}`);
    assert.ok(CATEGORIES.includes("WhatsApp"));
    assert.ok(CATEGORIES.includes("Sales"));
    assert.ok(CATEGORIES.includes("Guides"));
    assert.ok(CATEGORIES.includes("Regional"));
  });
});
