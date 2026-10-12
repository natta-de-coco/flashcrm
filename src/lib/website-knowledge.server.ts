// Public website reading runs through the shared crawler service. The CRM never
// fetches arbitrary website URLs from its own network or forwards user cookies.
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicKnowledgeUrl } from "./website-knowledge";

type Client = SupabaseClient<Database>;
export type SyncSummary = {
  siteUrl: string;
  pages: number;
  products: number;
  services: number;
  blogPosts: number;
  skipped: number;
  lastSyncedAt: string;
};

type ScrapedPage = { url: string; title: string; markdown: string; links: string[] };
async function scrape(url: string, key: string): Promise<ScrapedPage> {
  const response = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      formats: ["markdown", "links"],
      onlyMainContent: true,
      timeout: 15000,
      maxAge: 86400000,
      parsers: [],
      skipTlsVerification: false,
    }),
  });
  if (!response.ok)
    throw new Error(
      "Website reading is unavailable. Your admin can check the website reader's access and credits.",
    );
  const result = (await response.json()) as {
    success?: boolean;
    data?: {
      markdown?: string;
      links?: string[];
      metadata?: { title?: string; sourceURL?: string; statusCode?: number };
    };
  };
  const page = result.data;
  if (!result.success || !page?.markdown || (page.metadata?.statusCode ?? 200) >= 400)
    throw new Error("That page could not be read. It may be private, blocked or empty.");
  const source = publicKnowledgeUrl(page.metadata?.sourceURL ?? url);
  if (
    new URL(source).hostname.replace(/^www\./, "") !== new URL(url).hostname.replace(/^www\./, "")
  )
    throw new Error("That page redirects to another website. Use its final public address.");
  return {
    url: source,
    title: (page.metadata?.title ?? new URL(source).hostname).slice(0, 200),
    markdown: page.markdown.slice(0, 40_000),
    links: (page.links ?? []).filter((link) => typeof link === "string").slice(0, 300),
  };
}

/** One public page plus up to four relevant pages on that same site. No CMS login required. */
export async function syncWebsiteKnowledge(
  supabase: Client,
  siteInput: string,
  tenantId: string,
): Promise<SyncSummary> {
  if (!tenantId) throw new Error("Your workspace is not available.");
  const url = publicKnowledgeUrl(siteInput);
  const key = process.env["FIRECRAWL_API_KEY"]?.trim();
  if (!key)
    throw new Error(
      "Website reading needs a one-time setup by your FLAS admin. You can paste business information into the chatbot instructions meanwhile.",
    );
  const first = await scrape(url, key);
  const origin = new URL(first.url).origin;
  const candidates = [
    ...new Set(
      first.links.flatMap((link) => {
        try {
          const next = publicKnowledgeUrl(new URL(link, first.url).href);
          return new URL(next).origin === origin &&
            next !== first.url &&
            !/\.(pdf|png|jpg|jpeg|gif|svg|zip|js|css)$/i.test(new URL(next).pathname)
            ? [next]
            : [];
        } catch {
          return [];
        }
      }),
    ),
  ]
    .sort(
      (a, b) =>
        Number(/about|contact|service|product|faq|delivery|shipping/.test(b)) -
        Number(/about|contact|service|product|faq|delivery|shipping/.test(a)),
    )
    .slice(0, 4);
  const more = await Promise.allSettled(candidates.map((next) => scrape(next, key)));
  const pages = [first, ...more.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []))];
  const indexedAt = new Date().toISOString();
  const rows = pages.map((page) => ({
    tenant_id: tenantId,
    url: page.url,
    title: page.title,
    kind: /\/products?\//.test(page.url)
      ? "product"
      : /\/services?/.test(page.url)
        ? "service"
        : /\/blog\//.test(page.url)
          ? "blog"
          : "page",
    summary: page.markdown,
    keywords: null,
    word_count: page.markdown.split(/\s+/).length,
    indexed_at: indexedAt,
  }));
  const { error } = await supabase
    .from("website_pages")
    .upsert(rows, { onConflict: "tenant_id,url" });
  if (error)
    throw new Error("The website was read but its knowledge could not be saved. Please retry.");
  const summary = {
    siteUrl: origin,
    pages: rows.length,
    products: rows.filter((r) => r.kind === "product").length,
    services: rows.filter((r) => r.kind === "service").length,
    blogPosts: rows.filter((r) => r.kind === "blog").length,
    skipped: more.filter((r) => r.status === "rejected").length,
    lastSyncedAt: indexedAt,
  };
  const { error: stateError } = await supabase.from("website_sync_state").upsert(
    {
      tenant_id: tenantId,
      site_url: origin,
      last_synced_at: indexedAt,
      updated_at: indexedAt,
      pages: summary.pages,
      products: summary.products,
      services: summary.services,
      blog_posts: summary.blogPosts,
      status: "ready",
      error: null,
    },
    { onConflict: "tenant_id" },
  );
  if (stateError) throw new Error("The website knowledge could not be activated. Please retry.");
  return summary;
}
