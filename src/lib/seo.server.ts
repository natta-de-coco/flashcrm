// Server-only helpers for the SEO Studio: multimodal vision analysis, article
// drafting and WordPress REST publishing. WordPress application passwords are
// only ever read here (via the admin client) after the caller's tenant has
// been verified through their RLS-scoped client.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { callFlashAi, getBusinessContext } from "@/lib/flash-ai.server";

const VISION_MODEL = "google/gemini-3.7-flash";
const AI_GATEWAY = "https://ai.gateway.lovable.dev";

type RlsClient = { from: (table: string) => never };

function gatewayKey(): string {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("Flas AI is not configured yet — the workspace AI key is missing.");
  return key;
}

function gatewayError(status: number, raw: string): Error {
  let message = raw.slice(0, 300);
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string }; message?: string };
    message = parsed.error?.message ?? parsed.message ?? message;
  } catch {
    /* keep raw snippet */
  }
  if (status === 429) return new Error("Flas AI is busy right now — wait a few seconds and try again.");
  if (status === 402)
    return new Error("AI credits are exhausted — the workspace owner can top up in Lovable billing settings.");
  return new Error(`Flas AI request failed [${status}]: ${message}`);
}

/** Extracts a JSON object from a model reply that may wrap it in markdown fences. */
function parseJsonBlock<T>(text: string): T | null {
  const cleaned = text
    .replace(/^```(?:json)?/im, "")
    .replace(/```\s*$/m, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Vision analysis
// ---------------------------------------------------------------------------

export type VisionAnalysis = {
  objects: string[];
  brandColors: string[];
  ocrText: string[];
  productAttributes: string[];
  moodTags: string[];
  summary: string;
};

/** Multimodal extraction over up to 4 images passed as data URLs. */
export async function analyzeImages(images: string[], hint: string): Promise<VisionAnalysis> {
  const key = gatewayKey();
  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text:
        "You are a vision analyst for a marketing content studio. Analyze the attached image(s)." +
        (hint ? ` Business context: ${hint}.` : "") +
        " Respond with ONLY valid JSON (no markdown fences) in exactly this shape: " +
        '{"objects": string[] (visible objects/products), "brandColors": string[] (dominant colors as hex), ' +
        '"ocrText": string[] (any readable text), "productAttributes": string[] (materials, features, specs you can infer), ' +
        '"moodTags": string[] (tone/mood suggestions for copy), "summary": string (2 sentences for a copywriter)}.',
    },
  ];
  for (const img of images.slice(0, 4)) {
    content.push({ type: "image_url", image_url: { url: img } });
  }

  const res = await fetch(`${AI_GATEWAY}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "Lovable-API-Key": key,
    },
    body: JSON.stringify({ model: VISION_MODEL, messages: [{ role: "user", content }] }),
  });
  const raw = await res.text();
  if (!res.ok) throw gatewayError(res.status, raw);

  const json = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }> };
  const text = json.choices?.[0]?.message?.content?.trim() ?? "";
  const parsed = parseJsonBlock<Partial<VisionAnalysis>>(text);
  if (!parsed) {
    return {
      objects: [],
      brandColors: [],
      ocrText: [],
      productAttributes: [],
      moodTags: [],
      summary: text.slice(0, 500),
    };
  }
  return {
    objects: parsed.objects ?? [],
    brandColors: parsed.brandColors ?? [],
    ocrText: parsed.ocrText ?? [],
    productAttributes: parsed.productAttributes ?? [],
    moodTags: parsed.moodTags ?? [],
    summary: parsed.summary ?? "",
  };
}

// ---------------------------------------------------------------------------
// Article drafting
// ---------------------------------------------------------------------------

export type DraftParams = {
  primaryKeyword: string;
  industry: string;
  intent: string;
  tone: string;
  visionSummary: string;
  secondaryKeywords: string[];
};

export type SeoDraft = {
  title: string;
  metaTitle: string;
  metaDescription: string;
  slug: string;
  excerpt: string;
  contentHtml: string;
  secondaryKeywords: string[];
  faq: Array<{ q: string; a: string }>;
};

export async function generateArticleDraft(
  supabase: RlsClient,
  params: DraftParams,
): Promise<SeoDraft> {
  const biz = await getBusinessContext(supabase);
  const system =
    "You are Flas AI, an expert SEO content writer. You write long-form articles that rank and read like a human expert wrote them. " +
    "You respond with ONLY valid JSON — no markdown fences, no commentary.";
  const user = `Write a complete SEO blog article.

Business: ${biz?.business_name ?? "the company"} (${biz?.industry ?? params.industry})
About the business: ${biz?.description ?? "n/a"}
Known facts: ${biz?.learned_facts ?? "n/a"}
Primary keyword: ${params.primaryKeyword}
Industry/niche: ${params.industry}
Search intent: ${params.intent}
Tone of voice: ${params.tone}
Secondary keywords to weave in naturally: ${params.secondaryKeywords.join(", ") || "choose 4-6 relevant LSI keywords yourself"}
${params.visionSummary ? `Visual context from product/brand images: ${params.visionSummary}` : ""}

Requirements:
- 900-1400 words of body content in clean HTML using only <h2>, <h3>, <p>, <ul>, <li>, <blockquote>, <strong>, <em> tags. No <h1> (the title is separate) and no markdown.
- Structure: engaging intro, 4-6 H2 sections (some with H3 subsections), one blockquote highlight, a key-takeaways list, and a closing call-to-action paragraph.
- Use the primary keyword in the first paragraph and in at least one H2.
- Suggest 3 FAQ entries related to the topic.

Respond in EXACTLY this JSON shape:
{"title": string, "metaTitle": string (50-60 chars, includes primary keyword), "metaDescription": string (140-155 chars), "slug": string (lowercase-hyphenated), "excerpt": string (1-2 sentences), "contentHtml": string, "secondaryKeywords": string[] (4-6), "faq": [{"q": string, "a": string}]}`;

  const text = await callFlashAi(system, user);
  const parsed = parseJsonBlock<Partial<SeoDraft>>(text);
  if (!parsed || !parsed.title) {
    throw new Error("Flas AI returned an unreadable draft — try again.");
  }
  return {
    title: parsed.title,
    metaTitle: parsed.metaTitle ?? parsed.title,
    metaDescription: parsed.metaDescription ?? "",
    slug: parsed.slug ?? "",
    excerpt: parsed.excerpt ?? "",
    contentHtml: parsed.contentHtml ?? "",
    secondaryKeywords: parsed.secondaryKeywords ?? params.secondaryKeywords,
    faq: parsed.faq ?? [],
  };
}

export type MicroPost = { platform: string; text: string; hashtags: string[] };

export async function generateMicroPosts(
  supabase: RlsClient,
  params: DraftParams,
): Promise<MicroPost[]> {
  const biz = await getBusinessContext(supabase);
  const system =
    "You are Flas AI, a social media copywriter. Respond with ONLY valid JSON — no markdown fences.";
  const user = `Create omnichannel micro-posts for: Meta (Facebook/Instagram), LinkedIn, and TikTok.

Business: ${biz?.business_name ?? "the company"} — ${biz?.description ?? params.industry}
Topic/keyword: ${params.primaryKeyword}
Tone: ${params.tone}
${params.visionSummary ? `Visual context: ${params.visionSummary}` : ""}

Respond in EXACTLY this JSON shape:
{"posts": [{"platform": "Meta" | "LinkedIn" | "TikTok", "text": string (platform-appropriate length and style), "hashtags": string[] (3-6, no # prefix)}]}`;

  const text = await callFlashAi(system, user);
  const parsed = parseJsonBlock<{ posts?: MicroPost[] }>(text);
  if (!parsed?.posts?.length) throw new Error("Flas AI returned no posts — try again.");
  return parsed.posts;
}

/** One-click pass that rewrites robotic AI phrasing into natural prose. */
export async function humanizeHtml(contentHtml: string, tone: string): Promise<string> {
  const system =
    "You are Flas AI, an editor who makes AI text sound human. Keep the exact same HTML tag structure; only rewrite the prose inside tags. " +
    "Remove clichés, hype words and repetitive phrasing. Vary sentence length. Return ONLY the rewritten HTML.";
  const user = `Tone target: ${tone}.\n\nHTML to humanize:\n${contentHtml}`;
  const out = await callFlashAi(system, user);
  return out.trim() || contentHtml;
}

// ---------------------------------------------------------------------------
// WordPress REST
// ---------------------------------------------------------------------------

export type WpCreds = { siteUrl: string; username: string; appPassword: string };

function wpAuth(c: WpCreds): string {
  return `Basic ${Buffer.from(`${c.username}:${c.appPassword}`).toString("base64")}`;
}

async function wpFetch(c: WpCreds, path: string, init?: RequestInit): Promise<Response> {
  const url = `${c.siteUrl.replace(/\/+$/, "")}/wp-json/wp/v2${path}`;
  return fetch(url, {
    ...init,
    headers: { Authorization: wpAuth(c), ...(init?.headers ?? {}) },
  });
}

export async function testWpConnection(c: WpCreds): Promise<{
  user: string;
  categories: Array<{ id: number; name: string }>;
  tags: Array<{ id: number; name: string }>;
}> {
  const me = await wpFetch(c, "/users/me");
  if (!me.ok) {
    const body = await me.text();
    throw new Error(
      `WordPress rejected the connection [${me.status}] — check the site URL, username and application password. ${body.slice(0, 200)}`,
    );
  }
  const user = (await me.json()) as { name?: string };
  const [cats, tags] = await Promise.all([
    wpFetch(c, "/categories?per_page=100"),
    wpFetch(c, "/tags?per_page=100"),
  ]);
  const categories = cats.ok
    ? ((await cats.json()) as Array<{ id: number; name: string }>).map((x) => ({
        id: x.id,
        name: x.name,
      }))
    : [];
  const tagList = tags.ok
    ? ((await tags.json()) as Array<{ id: number; name: string }>).map((x) => ({
        id: x.id,
        name: x.name,
      }))
    : [];
  return { user: user.name ?? "connected", categories, tags: tagList };
}

function seoMetaKeys(
  plugin: string,
  metaTitle: string,
  metaDescription: string,
): Record<string, string> {
  switch (plugin) {
    case "yoast":
      return { _yoast_wpseo_title: metaTitle, _yoast_wpseo_metadesc: metaDescription };
    case "rankmath":
      return { rank_math_title: metaTitle, rank_math_description: metaDescription };
    case "seopress":
      return { _seopress_titles_title: metaTitle, _seopress_titles_desc: metaDescription };
    default:
      return {};
  }
}

/** Uploads a featured image (data URL) to the WP media library; returns its id + URL. */
async function uploadFeaturedMedia(
  c: WpCreds,
  dataUrl: string,
): Promise<{ id: number; url: string } | null> {
  const match = /^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const mime = match[1]!;
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  const buffer = Buffer.from(match[2]!, "base64");
  const res = await wpFetch(c, "/media", {
    method: "POST",
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `attachment; filename="flas-featured-${Date.now()}.${ext}"`,
    },
    body: new Uint8Array(buffer),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { id?: number; source_url?: string };
  return json.id ? { id: json.id, url: json.source_url ?? "" } : null;
}

export type PublishInput = {
  siteId: string;
  tenantId: string;
  article: {
    id: string;
    title: string;
    slug: string | null;
    excerpt: string | null;
    contentHtml: string;
    metaTitle: string;
    metaDescription: string;
  };
  status: "draft" | "pending" | "publish" | "future";
  featuredImageDataUrl?: string | null;
  scheduledAt?: string | null;
};

export type PublishResult = { wpPostId: number; url: string; featuredImageUrl: string | null };

export async function publishToWordPress(input: PublishInput): Promise<PublishResult> {
  // Read the safe site row first (proves tenant access through RLS), then load
  // the application password with the admin client — it is never API-readable.
  const { data: siteSafe } = await supabaseAdmin
    .from("wordpress_sites")
    .select("id, tenant_id, site_url, username, app_password, seo_plugin")
    .eq("id", input.siteId)
    .eq("tenant_id", input.tenantId)
    .maybeSingle();
  if (!siteSafe) throw new Error("WordPress site not found for this workspace.");

  const creds: WpCreds = {
    siteUrl: siteSafe.site_url,
    username: siteSafe.username,
    appPassword: siteSafe.app_password,
  };

  let featured: { id: number; url: string } | null = null;
  if (input.featuredImageDataUrl) {
    featured = await uploadFeaturedMedia(creds, input.featuredImageDataUrl);
  }

  const meta = seoMetaKeys(siteSafe.seo_plugin, input.article.metaTitle, input.article.metaDescription);
  const payload: Record<string, unknown> = {
    title: input.article.title,
    content: input.article.contentHtml,
    excerpt: input.article.excerpt ?? "",
    status: input.status,
  };
  if (input.article.slug) payload["slug"] = input.article.slug;
  if (featured) payload["featured_media"] = featured.id;
  if (input.status === "future" && input.scheduledAt) payload["date"] = input.scheduledAt;
  if (Object.keys(meta).length > 0) payload["meta"] = meta;

  const isUpdate = Boolean(
    (input.article as { wpPostId?: number | null }).wpPostId,
  );
  const existingId = (input.article as { wpPostId?: number | null }).wpPostId;

  let res = await wpFetch(creds, isUpdate ? `/posts/${existingId}` : "/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  // Some SEO plugins don't expose their meta keys over REST — retry without.
  if (!res.ok && Object.keys(meta).length > 0) {
    const body = await res.text();
    if (body.includes("meta") || res.status === 400) {
      delete payload["meta"];
      res = await wpFetch(creds, isUpdate ? `/posts/${existingId}` : "/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      throw new Error(`WordPress publish failed [${res.status}]: ${body.slice(0, 300)}`);
    }
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WordPress publish failed [${res.status}]: ${body.slice(0, 300)}`);
  }

  const post = (await res.json()) as { id?: number; link?: string };
  if (!post.id) throw new Error("WordPress did not return a post ID.");
  return { wpPostId: post.id, url: post.link ?? "", featuredImageUrl: featured?.url ?? null };
}

export async function getSiteForTenant(
  supabase: RlsClient,
  siteId: string,
): Promise<{ id: string; tenant_id: string } | null> {
  const { data } = await (supabase.from("wordpress_sites") as never as {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string,
      ) => { maybeSingle: () => Promise<{ data: { id: string; tenant_id: string } | null }> };
    };
  })
    .select("id, tenant_id")
    .eq("id", siteId)
    .maybeSingle();
  return data ?? null;
}
