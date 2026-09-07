// Client-safe SEO analysis utilities for the studio sidebar: audit checklist,
// readability, keyword usage, slug and JSON-LD generation.

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]e|ed|es)$/, "").match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Flesch-Kincaid grade level (lower = easier to read). */
export function fleschKincaidGrade(text: string): number {
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const words = text.split(/\s+/).filter((w) => /[a-zA-Z]/.test(w));
  if (sentences.length === 0 || words.length === 0) return 0;
  const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  const grade =
    0.39 * (words.length / sentences.length) + 11.8 * (syllables / words.length) - 15.59;
  return Math.max(0, Math.round(grade * 10) / 10);
}

export function keywordDensity(text: string, keyword: string): number {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const kw = keyword.toLowerCase().trim();
  if (!kw || words.length === 0) return 0;
  const kwWords = kw.split(/\s+/).length;
  let hits = 0;
  const haystack = ` ${text.toLowerCase()} `;
  let idx = 0;
  while ((idx = haystack.indexOf(` ${kw} `, idx)) !== -1) {
    hits += 1;
    idx += kw.length;
  }
  return Math.round(((hits * kwWords) / words.length) * 1000) / 10;
}

export type SeoCheck = {
  id: string;
  label: string;
  passed: boolean;
  detail?: string;
};

export type SeoAuditInput = {
  title: string;
  metaTitle: string;
  metaDescription: string;
  contentHtml: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  imageAlts: string[];
};

export type SeoAudit = {
  score: number;
  checks: SeoCheck[];
  usedSecondary: string[];
  wordCount: number;
  grade: number;
  density: number;
};

export function computeSeoAudit(input: SeoAuditInput): SeoAudit {
  const text = stripHtml(input.contentHtml);
  const words = text.split(/\s+/).filter(Boolean).length;
  const kw = input.primaryKeyword.trim().toLowerCase();
  const grade = fleschKincaidGrade(text);
  const density = keywordDensity(text, kw);

  const usedSecondary = input.secondaryKeywords.filter(
    (k) => k.trim() && text.toLowerCase().includes(k.trim().toLowerCase()),
  );

  const checks: SeoCheck[] = [
    {
      id: "title-kw",
      label: "Title includes primary keyword",
      passed: kw.length > 0 && input.title.toLowerCase().includes(kw),
    },
    {
      id: "meta-title-len",
      label: "Meta title 50–60 characters",
      passed: input.metaTitle.length >= 50 && input.metaTitle.length <= 60,
      detail: `${input.metaTitle.length} chars`,
    },
    {
      id: "meta-desc-len",
      label: "Meta description 140–155 characters",
      passed: input.metaDescription.length >= 140 && input.metaDescription.length <= 155,
      detail: `${input.metaDescription.length} chars`,
    },
    {
      id: "density",
      label: "Keyword density 1.2–2.5%",
      passed: density >= 1.2 && density <= 2.5,
      detail: `${density}%`,
    },
    {
      id: "length",
      label: "At least 600 words",
      passed: words >= 600,
      detail: `${words} words`,
    },
    {
      id: "headings",
      label: "Uses H2/H3 section headings",
      passed: /<h2[\s>]/i.test(input.contentHtml),
    },
    {
      id: "alts",
      label: "All images have alt text",
      passed: input.imageAlts.length === 0 || input.imageAlts.every((a) => a.trim().length > 0),
    },
    {
      id: "readability",
      label: "Readable (grade ≤ 9)",
      passed: grade > 0 && grade <= 9,
      detail: `Grade ${grade}`,
    },
    {
      id: "secondary",
      label: "Uses secondary keywords",
      passed: input.secondaryKeywords.length === 0 || usedSecondary.length > 0,
      detail: `${usedSecondary.length}/${input.secondaryKeywords.length}`,
    },
  ];

  const passed = checks.filter((c) => c.passed).length;
  const score = Math.round((passed / checks.length) * 100);
  return { score, checks, usedSecondary, wordCount: words, grade, density };
}

export function buildArticleJsonLd(input: {
  title: string;
  metaDescription: string;
  slug: string;
  siteUrl?: string | undefined;
  businessName?: string | undefined;
  featuredImageUrl?: string | null | undefined;
  faq?: Array<{ q: string; a: string }> | undefined;
}): Record<string, unknown> {
  const base = input.siteUrl?.replace(/\/+$/, "") ?? "";
  const article: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.title,
    description: input.metaDescription,
    mainEntityOfPage: base && input.slug ? `${base}/${input.slug}` : undefined,
    author: input.businessName ? { "@type": "Organization", name: input.businessName } : undefined,
    image: input.featuredImageUrl ?? undefined,
  };
  const graph: Array<Record<string, unknown>> = [article];
  if (input.faq && input.faq.length > 0) {
    graph.push({
      "@type": "FAQPage",
      mainEntity: input.faq.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    });
  }
  return {
    "@context": "https://schema.org",
    "@graph": graph.map((g) => ({ ...g, "@context": undefined })),
  };
}
