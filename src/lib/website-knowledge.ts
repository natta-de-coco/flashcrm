/** Browser-safe address validation and ranked excerpts; no model or API keys here. */
export function publicKnowledgeUrl(input: string): string {
  const url = new URL(
    /^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`,
  );
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  // URLs are sent to a public crawler, never fetched from the CRM's network.
  // Only DNS hostnames are accepted; private/IP literals and local names have no use here.
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !host.includes(".") ||
    host.includes(":") ||
    /^[\d.]+$/.test(host) ||
    /\.(localhost|local|internal|test|invalid|example|home|lan)$/.test(host) ||
    host.endsWith(".localdomain")
  )
    throw new Error(
      "Use the address of a public website. Local addresses and sign-in links cannot be read.",
    );
  url.hostname = host;
  url.hash = "";
  url.search = "";
  return url.href;
}

type Page = { url: string; title: string | null; summary: string | null; indexed_at: string };
export function relevantWebsiteExcerpts(
  pages: Page[],
  question: string,
  origin: string,
  indexedAt: string,
) {
  const stop = new Set(
    "what when where how does do is are the a an of for to in on with you your our we can could please tell me it this that have has".split(
      " ",
    ),
  );
  const terms = [...new Set(question.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])]
    .filter((t) => !stop.has(t))
    .slice(0, 30);
  const ranked = pages.flatMap((page) => {
    try {
      if (new URL(page.url).origin !== origin || page.indexed_at !== indexedAt) return [];
    } catch {
      return [];
    }
    const text = (page.summary ?? "").slice(0, 40_000);
    const chunks = [];
    for (let start = 0; start < text.length; start += 1000) {
      const excerpt = text.slice(start, start + 1200);
      const lower = `${page.title ?? ""} ${excerpt}`.toLowerCase();
      const score = terms.reduce((n, t) => n + (lower.includes(t) ? 1 : 0), 0);
      if (score > 0)
        chunks.push({
          url: page.url,
          title: page.title,
          text: excerpt,
          indexedAt: page.indexed_at,
          score,
        });
    }
    return chunks;
  });
  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(({ score: _score, ...excerpt }) => excerpt);
}
