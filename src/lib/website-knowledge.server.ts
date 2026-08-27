// Server-only website knowledge sync. Flas reads the business's own public
// website (sitemap first, then homepage links), extracts readable text and
// stores a compact knowledge record per page. No third-party sites are crawled.
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

type Client = SupabaseClient<Database>;

const MAX_PAGES = 60;
const FETCH_TIMEOUT = 8000;

async function get(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "FlashCRM-KnowledgeSync/1.0 (+business owner authorized)" },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html") && !type.includes("xml")) return null;
    return (await res.text()).slice(0, 400_000);
  } catch {
    return null;
  }
}

function normalizeSite(input: string): string | null {
  try {
    const url = new URL(input.startsWith("http") ? input : `https://${input}`);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function textOf(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleOf(html: string): string | null {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i);
  if (og?.[1]) return og[1].slice(0, 200);
  const t = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return t?.[1]?.trim().slice(0, 200) ?? null;
}

function classify(url: string): string {
  const p = url.toLowerCase();
  if (/\/(blog|news|article|post)s?\//.test(p)) return "blog";
  if (/\/(product|shop|store|item)s?\//.test(p)) return "product";
  if (/\/(service|solution)s?\//.test(p)) return "service";
  if (/\/(faq|help|support)/.test(p)) return "faq";
  if (/\/about/.test(p)) return "about";
  if (/\/contact/.test(p)) return "contact";
  if (/\/(category|collection)/.test(p)) return "category";
  return "page";
}

function keywordsOf(text: string): string {
  const stop = new Set(
    "the a an and or of for to in on with your you our we is are be from that this it as at by will can more all not have has".split(
      " ",
    ),
  );
  const counts = new Map<string, number>();
  for (const raw of text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []) {
    if (stop.has(raw)) continue;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([w]) => w)
    .join(", ");
}

async function urlsFromSitemap(origin: string): Promise<string[]> {
  const found: string[] = [];
  const roots = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/wp-sitemap.xml`];
  for (const root of roots) {
    const xml = await get(root);
    if (!xml) continue;
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => m[1]!.trim());
    const nested = locs.filter((l) => l.endsWith(".xml")).slice(0, 5);
    found.push(...locs.filter((l) => !l.endsWith(".xml")));
    for (const child of nested) {
      const childXml = await get(child);
      if (!childXml) continue;
      found.push(
        ...[...childXml.matchAll(/<loc>([^<]+)<\/loc>/gi)]
          .map((m) => m[1]!.trim())
          .filter((l) => !l.endsWith(".xml")),
      );
    }
    if (found.length) break;
  }
  return [...new Set(found)];
}

async function urlsFromHome(origin: string): Promise<string[]> {
  const html = await get(origin);
  if (!html) return [];
  const links = [...html.matchAll(/href=["']([^"'#?]+)["']/gi)].map((m) => m[1]!);
  const out = new Set<string>([origin]);
  for (const href of links) {
    try {
      const abs = new URL(href, origin);
      if (abs.origin !== origin) continue;
      if (/\.(png|jpe?g|svg|webp|pdf|zip|css|js|ico)$/i.test(abs.pathname)) continue;
      out.add(`${abs.origin}${abs.pathname.replace(/\/$/, "") || "/"}`);
    } catch {
      /* ignore malformed links */
    }
  }
  return [...out];
}

export type SyncSummary = {
  siteUrl: string;
  pages: number;
  products: number;
  services: number;
  blogPosts: number;
  skipped: number;
  lastSyncedAt: string;
};

/** Indexes the business's own website into the Flas knowledge base. */
export async function syncWebsiteKnowledge(
  supabase: Client,
  siteInput: string,
): Promise<SyncSummary> {
  const origin = normalizeSite(siteInput);
  if (!origin) throw new Error("That website address is not valid.");

  let urls = await urlsFromSitemap(origin);
  if (urls.length === 0) urls = await urlsFromHome(origin);
  if (urls.length === 0) {
    throw new Error(
      "Flas could not read that website. Check the address is public and reachable, then try again.",
    );
  }
  urls = urls.filter((u) => u.startsWith(origin)).slice(0, MAX_PAGES);

  let skipped = 0;
  const rows: {
    url: string;
    title: string | null;
    kind: string;
    word_count: number;
    summary: string | null;
    keywords: string | null;
    indexed_at: string;
  }[] = [];

  for (const url of urls) {
    const html = await get(url);
    if (!html) {
      skipped += 1;
      continue;
    }
    const text = textOf(html);
    if (text.length < 120) {
      skipped += 1;
      continue;
    }
    rows.push({
      url,
      title: titleOf(html),
      kind: url === origin ? "home" : classify(url),
      word_count: text.split(" ").length,
      summary: text.slice(0, 1200),
      keywords: keywordsOf(text),
      indexed_at: new Date().toISOString(),
    });
  }

  if (rows.length) {
    const { error } = await supabase
      .from("website_pages")
      .upsert(rows as never, { onConflict: "tenant_id,url" });
    if (error) throw error;
  }

  const count = (kind: string) => rows.filter((r) => r.kind === kind).length;
  const summary: SyncSummary = {
    siteUrl: origin,
    pages: rows.length,
    products: count("product"),
    services: count("service"),
    blogPosts: count("blog"),
    skipped,
    lastSyncedAt: new Date().toISOString(),
  };

  const { error: stateError } = await supabase.from("website_sync_state").upsert(
    {
      site_url: origin,
      last_synced_at: summary.lastSyncedAt,
      pages: summary.pages,
      products: summary.products,
      services: summary.services,
      blog_posts: summary.blogPosts,
      status: "ready",
      error: null,
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: "tenant_id" },
  );
  if (stateError) throw stateError;

  return summary;
}
