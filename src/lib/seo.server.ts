// Server-only helpers for the SEO Studio: multimodal vision analysis, article
// drafting and WordPress REST publishing. WordPress application passwords are
// only ever read here (via the admin client) after the caller's tenant has
// been verified through their RLS-scoped client.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { aiOptionsFor, callFlashAi, getBusinessContext } from "@/lib/flash-ai.server";

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
  if (status === 429)
    return new Error("Flas AI is busy right now — wait a few seconds and try again.");
  if (status === 402)
    return new Error(
      "AI credits are exhausted — the workspace owner can top up in Lovable billing settings.",
    );
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
    "You are Flas AI, an elite SEO and growth marketing specialist operating under the Brand & Product Comparison and Benchmark Framework. " +
    "You write high-authority, data-backed articles designed to win Google Featured Snippets, dominate AI Overviews (SGE), and convert commercial intent searchers into qualified buyers. " +
    "You respond with ONLY valid JSON — no markdown fences, no commentary.";

  const user = `Write a high-ranking, publication-ready SEO article based on our company knowledge base and benchmark methodologies.

COMPANY KNOWLEDGE BASE:
Business Name: ${biz?.business_name ?? "the company"}
Industry/Niche: ${biz?.industry ?? params.industry}
Description: ${biz?.description ?? "n/a"}
Known Facts & Capabilities: ${biz?.learned_facts ?? "n/a"}
Website / Channels: ${biz?.website_url ?? "n/a"}
${biz?.qa ? `Common Q&A: ${JSON.stringify(biz.qa)}` : ""}

TARGET KEYWORDS & PARAMETERS:
Primary Keyword: ${params.primaryKeyword}
Search Intent: ${params.intent} (Optimize specifically for commercial investigation & decision-making)
Tone of Voice: ${params.tone}
Secondary / LSI Keywords to weave in naturally: ${params.secondaryKeywords.join(", ") || "choose 4-6 high-intent LSI keywords"}
${params.visionSummary ? `Visual Context from Images: ${params.visionSummary}` : ""}

ELITE SEO & BENCHMARK REQUIREMENTS:
1. 1,000–1,500 words of rich, authoritative body HTML using <h2>, <h3>, <p>, <ul>, <ol>, <li>, <table>, <thead>, <tbody>, <tr>, <th>, <td>, <blockquote>, <strong>, <em> tags. (NO <h1> tags; title is separate).
2. Featured Snippet Hook: In the very first section under <h2>, include a bold 45–55 word direct answer paragraph that directly addresses the core search query so Google can scrape it for the Featured Snippet / AI Overview.
3. Benchmark / Comparison Table: Include at least ONE comprehensive semantic HTML <table> with <thead> and <tbody> comparing workflows, metrics, or options side-by-side with clear, objective criteria.
4. Stress-Test Scenario: Include a real-world scenario (e.g. an order revision, handling incomplete customer info, or shift handoffs) that tests performance under operational reality rather than abstract feature counts.
5. Defensible Trade-offs (E-E-A-T): Be genuinely helpful and objective—include a clear breakdown of where our business excels and the exact situations where an alternative solution is the better choice.
6. Keyword Optimization: Maintain natural keyword density (1.2%–2.2%) for "${params.primaryKeyword}" and weave in all secondary keywords seamlessly.
7. High-Intent FAQ: Suggest 3–4 detailed FAQ entries formulated around "People Also Ask" questions.

Respond in EXACTLY this JSON shape:
{"title": string, "metaTitle": string (50-60 chars, includes primary keyword), "metaDescription": string (140-155 chars), "slug": string (lowercase-hyphenated), "excerpt": string (1-2 sentences), "contentHtml": string, "secondaryKeywords": string[] (4-6), "faq": [{"q": string, "a": string}]}`;

  const text = await callFlashAi(system, user, await aiOptionsFor(supabase, "seo_article"));
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

export type PlatformKey = "instagram" | "linkedin" | "tiktok" | "facebook" | "twitter";

export type PlatformSpec = {
  key: PlatformKey;
  platformName: string;
  aspectRatio: string;
  resolution: string;
  mediaType: string;
  charLimit: number;
  recommendedStyle: string;
  hookGuide: string;
};

export const PLATFORM_SPECS: Record<PlatformKey, PlatformSpec> = {
  instagram: {
    key: "instagram",
    platformName: "Instagram",
    aspectRatio: "4:5 (Portrait) or 1:1 (Square)",
    resolution: "1080 x 1350 px",
    mediaType: "Carousel / Reel / High-Contrast Image",
    charLimit: 2200,
    recommendedStyle:
      "Visual hook in line 1, clean line breaks, micro-story/carousel caption, conversational emojis, clear CTA.",
    hookGuide:
      "Start with an unexpected question or relatable friction point before the caption cutoff.",
  },
  linkedin: {
    key: "linkedin",
    platformName: "LinkedIn",
    aspectRatio: "1.91:1 (Landscape) or 1:1 (Square)",
    resolution: "1200 x 627 px (Feed) / 1080 x 1350 px (PDF)",
    mediaType: "Document Carousel / Infographic",
    charLimit: 3000,
    recommendedStyle:
      "Professional insight, contrarian industry data point, 3-4 bullet takeaways, discussion-starter question.",
    hookGuide:
      "Contrarian statement or high-value data benchmark that challenges standard business assumptions.",
  },
  tiktok: {
    key: "tiktok",
    platformName: "TikTok",
    aspectRatio: "9:16 (Full Screen Vertical)",
    resolution: "1080 x 1920 px",
    mediaType: "Vertical Video Script & Caption",
    charLimit: 2200,
    recommendedStyle:
      "3-part script: [0-3s Visual Hook] + [Core Voiceover] + [Caption & CTA] + 4-6 viral and niche discovery tags.",
    hookGuide:
      "High-energy 3-second pattern interrupt directly addressing a major workflow frustration.",
  },
  facebook: {
    key: "facebook",
    platformName: "Facebook",
    aspectRatio: "1.91:1 (Landscape) or 1:1 (Square)",
    resolution: "1200 x 630 px",
    mediaType: "Image with Rich Link Preview",
    charLimit: 63206,
    recommendedStyle:
      "Community-driven, conversational storytelling, relatable pain points, clear discussion trigger.",
    hookGuide:
      "Relatable business or customer scenario that invites community comments and shares.",
  },
  twitter: {
    key: "twitter",
    platformName: "X (Twitter)",
    aspectRatio: "16:9 (Landscape)",
    resolution: "1200 x 675 px",
    mediaType: "Single Image / Post Card",
    charLimit: 280,
    recommendedStyle:
      "Punchy one-liner hook, bold insight, tight concise wording, 1-2 focused hashtags.",
    hookGuide:
      "Bold thesis or punchy stat under 100 characters that compels a repost or quote-tweet.",
  },
};

export type MicroPost = {
  platform: PlatformKey;
  platformName: string;
  text: string;
  hashtags: string[];
  specs: PlatformSpec;
  verified?: boolean;
};

export async function generateMicroPosts(
  supabase: RlsClient,
  params: DraftParams,
): Promise<MicroPost[]> {
  const biz = await getBusinessContext(supabase);
  const system =
    "You are Flas AI, an elite omnichannel growth marketer specializing in platform-native social copywriting, visual resolution optimization, psychological hooks, and 3-tier hashtag architecture. " +
    "You write uniquely for every social network according to its exact culture, aspect ratios, and character constraints. " +
    "You respond with ONLY valid JSON — no markdown fences.";

  const user = `Create high-converting social posts tailored for each platform's unique writing style, resolution specs, and audience:

COMPANY KNOWLEDGE BASE:
Business Name: ${biz?.business_name ?? "the company"}
Industry: ${biz?.description ?? params.industry}
Key Offerings & Facts: ${biz?.learned_facts ?? "n/a"}
Website: ${biz?.website_url ?? "n/a"}
Topic/Primary Keyword: ${params.primaryKeyword}
Tone: ${params.tone}
${params.visionSummary ? `Visual Context: ${params.visionSummary}` : ""}

PLATFORM SPECIFIC REQUIREMENTS:
1. Instagram (Resolution: 1080x1350px 4:5): Visual hook in line 1, clean paragraph spacing, storytelling caption, conversational tone, 5-8 hashtags (3-Tier method).
2. LinkedIn (Resolution: 1200x627px 1.91:1): Thought-leadership or contrarian benchmark hook, 3-4 bullet takeaways, professional tone, engaging closing question, 3-5 tags.
3. TikTok (Resolution: 1080x1920px 9:16): Script format with [Hook: 0-3s visual text], [Voiceover / demo], and [Caption + CTA], 4-6 tags.
4. Facebook (Resolution: 1200x630px 1.91:1): Conversational community post, relatable pain point, link/action prompt, 2-3 tags.
5. Twitter / X (Resolution: 1200x675px 16:9): Sharp, punchy text STRICTLY UNDER 260 characters, bold thesis/stat, 1-2 tags.

Respond in EXACTLY this JSON shape:
{"posts": [
  {"platform": "instagram", "text": string, "hashtags": string[]},
  {"platform": "linkedin", "text": string, "hashtags": string[]},
  {"platform": "tiktok", "text": string, "hashtags": string[]},
  {"platform": "facebook", "text": string, "hashtags": string[]},
  {"platform": "twitter", "text": string, "hashtags": string[]}
]}`;

  const text = await callFlashAi(system, user, await aiOptionsFor(supabase, "seo_micro_posts"));
  const parsed = parseJsonBlock<{
    posts?: Array<{ platform: string; text: string; hashtags: string[] }>;
  }>(text);
  if (!parsed?.posts?.length) throw new Error("Flas AI returned no posts — try again.");

  return parsed.posts.map((p) => {
    const rawKey = p.platform.toLowerCase();
    const key: PlatformKey = rawKey.includes("insta")
      ? "instagram"
      : rawKey.includes("link")
        ? "linkedin"
        : rawKey.includes("tik")
          ? "tiktok"
          : rawKey.includes("face")
            ? "facebook"
            : rawKey.includes("twit") || rawKey.includes("x")
              ? "twitter"
              : "instagram";
    const specs = PLATFORM_SPECS[key];
    return {
      platform: key,
      platformName: specs.platformName,
      text: p.text,
      hashtags: p.hashtags.map((h) => h.replace(/^#/, "").trim()).filter(Boolean),
      specs,
      verified: false,
    };
  });
}

/** Recreates or regenerates copy for a single platform using its specific guidelines. */
export async function generateSingleMicroPost(
  supabase: RlsClient,
  input: { platform: PlatformKey; params: DraftParams },
): Promise<MicroPost> {
  const biz = await getBusinessContext(supabase);
  const specs = PLATFORM_SPECS[input.platform];
  const system =
    `You are Flas AI, specializing in ${specs.platformName} marketing, hooks, and format optimization. ` +
    `Resolution: ${specs.resolution} (${specs.aspectRatio}). Style: ${specs.recommendedStyle}. ` +
    "Respond with ONLY valid JSON — no markdown fences.";

  const user = `Write a fresh, high-performing post for ${specs.platformName}.
Topic: ${input.params.primaryKeyword}
Tone: ${input.params.tone}
Business: ${biz?.business_name ?? "the company"} (${biz?.industry ?? input.params.industry})
Known facts: ${biz?.learned_facts ?? "n/a"}
${input.params.visionSummary ? `Visual Context: ${input.params.visionSummary}` : ""}

Constraints:
- ${specs.platformName} native format: ${specs.recommendedStyle}
- Character limit: ${specs.charLimit} chars max
- Include 3-6 relevant hashtags without '#' prefix

Respond in EXACTLY this JSON shape:
{"text": string, "hashtags": string[]}`;

  const text = await callFlashAi(system, user, await aiOptionsFor(supabase, "seo_micro_posts"));
  const parsed = parseJsonBlock<{ text?: string; hashtags?: string[] }>(text);
  if (!parsed?.text) throw new Error(`Could not generate new post for ${specs.platformName}.`);

  return {
    platform: input.platform,
    platformName: specs.platformName,
    text: parsed.text,
    hashtags: (parsed.hashtags ?? []).map((h) => h.replace(/^#/, "").trim()).filter(Boolean),
    specs,
    verified: false,
  };
}

/** Publishes a verified micro-post into the CRM's social pipeline (social_posts). */
export async function publishMicroPostToSocial(
  supabase: RlsClient,
  input: {
    platform: PlatformKey;
    text: string;
    hashtags: string[];
    scheduledAt?: string | null;
  },
): Promise<{ ok: boolean; postId?: string | undefined; accountName?: string | undefined }> {
  const fullCaption =
    `${input.text.trim()}\n\n${input.hashtags.map((h) => `#${h}`).join(" ")}`.trim();

  // Find matching connected account if one exists
  const client = supabase as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (
          col: string,
          val: unknown,
        ) => {
          eq: (
            col: string,
            val: unknown,
          ) => {
            limit: (n: number) => {
              maybeSingle: () => Promise<{ data: { id: string; label: string } | null }>;
            };
          };
        };
      };
      insert: (record: Record<string, unknown>) => {
        select: (col: string) => {
          single: () => Promise<{ data: { id: string } | null; error: unknown }>;
        };
      };
    };
  };

  const { data: account } = await client
    .from("social_accounts")
    .select("id, label")
    .eq("platform", input.platform)
    .eq("active", true)
    .limit(1)
    .maybeSingle();

  const { data: created, error } = await client
    .from("social_posts")
    .insert({
      caption: fullCaption,
      account_id: account?.id ?? null,
      status: input.scheduledAt ? "scheduled" : "draft",
      scheduled_at: input.scheduledAt ?? null,
    })
    .select("id")
    .single();

  if (error) throw error;
  return { ok: true, postId: created?.id, accountName: account?.label };
}

/** One-click pass that rewrites robotic AI phrasing into natural prose. */
export async function humanizeHtml(
  contentHtml: string,
  tone: string,
  tenantId?: string | null,
): Promise<string> {
  const system =
    "You are Flas AI, an editor who makes AI text sound human. Keep the exact same HTML tag structure; only rewrite the prose inside tags. " +
    "Remove clichés, hype words and repetitive phrasing. Vary sentence length. Return ONLY the rewritten HTML.";
  const user = `Tone target: ${tone}.\n\nHTML to humanize:\n${contentHtml}`;
  const out = await callFlashAi(system, user, {
    tenantId: tenantId ?? null,
    feature: "seo_humanize",
  });
  return out.trim() || contentHtml;
}

// ---------------------------------------------------------------------------
// WordPress REST
// ---------------------------------------------------------------------------

export type WpCreds = { siteUrl: string; username: string; appPassword: string };

export function normalizeWpUrl(rawUrl: string): string {
  let u = (rawUrl ?? "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) {
    u = `https://${u}`;
  }
  u = u.replace(/\/+$/, "");
  u = u.replace(/\/wp-admin(?:\/.*)?$/i, "");
  u = u.replace(/\/wp-json(?:\/.*)?$/i, "");
  return u;
}

function wpAuth(c: WpCreds): string {
  const cleanAppPass = (c.appPassword ?? "").replace(/\s+/g, "");
  return `Basic ${Buffer.from(`${c.username.trim()}:${cleanAppPass}`).toString("base64")}`;
}

async function wpFetch(c: WpCreds, path: string, init?: RequestInit): Promise<Response> {
  const cleanBase = normalizeWpUrl(c.siteUrl);
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${cleanBase}/wp-json/wp/v2${cleanPath}`;

  const defaultHeaders: Record<string, string> = {
    Authorization: wpAuth(c),
    Accept: "application/json",
    "User-Agent": "FlasCRM/1.0 (+https://flas.mobidigisol.com; WordPress Integration)",
  };

  let res = await fetch(url, {
    ...init,
    headers: {
      ...defaultHeaders,
      ...(init?.headers ?? {}),
    },
  });

  // When fetch follows cross-scheme or cross-domain redirects (e.g. http->https or non-www->www),
  // standard fetch drops Authorization headers, returning 401. Re-attempt with auth on redirected url.
  if (res.status === 401 && res.url && res.url !== url) {
    res = await fetch(res.url, {
      ...init,
      headers: {
        ...defaultHeaders,
        ...(init?.headers ?? {}),
      },
    });
  }

  return res;
}

export async function testWpConnection(c: WpCreds): Promise<{
  user: string;
  categories: Array<{ id: number; name: string }>;
  tags: Array<{ id: number; name: string }>;
}> {
  let me: Response;
  try {
    me = await wpFetch(c, "/users/me");
  } catch (err) {
    throw new Error(
      `Could not reach WordPress site at ${c.siteUrl}: ${err instanceof Error ? err.message : String(err)}. Check that the domain is online and reachable.`,
    );
  }

  if (!me.ok) {
    const body = await me.text();
    let detail = "";
    try {
      const parsed = JSON.parse(body) as { message?: string; code?: string };
      if (parsed.message) detail = `: ${parsed.message}`;
    } catch {
      detail = body ? `: ${body.slice(0, 150)}` : "";
    }

    if (me.status === 401) {
      throw new Error(
        `WordPress authentication failed (HTTP 401)${detail}. Check that your Application Password is correct, and that your site URL uses HTTPS.`,
      );
    }
    if (me.status === 403) {
      throw new Error(
        `WordPress access denied (HTTP 403)${detail}. Check your user permissions in WordPress (Administrator/Editor role needed) or firewall rules (Wordfence/Cloudflare).`,
      );
    }
    if (me.status === 404) {
      throw new Error(
        `WordPress REST API not found (HTTP 404). Ensure permalinks are enabled in WordPress (Settings > Permalinks, select 'Post name' rather than 'Plain').`,
      );
    }
    throw new Error(`WordPress rejected the connection [${me.status}]${detail}`);
  }

  const user = (await me.json()) as { name?: string };
  const [cats, tags] = await Promise.all([
    wpFetch(c, "/categories?per_page=100").catch(() => null),
    wpFetch(c, "/tags?per_page=100").catch(() => null),
  ]);
  const categories =
    cats && cats.ok
      ? ((await cats.json()) as Array<{ id: number; name: string }>).map((x) => ({
          id: x.id,
          name: x.name,
        }))
      : [];
  const tagList =
    tags && tags.ok
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

  const meta = seoMetaKeys(
    siteSafe.seo_plugin,
    input.article.metaTitle,
    input.article.metaDescription,
  );
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

  const isUpdate = Boolean((input.article as { wpPostId?: number | null }).wpPostId);
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
      let detail = "";
      try {
        const parsed = JSON.parse(body) as { message?: string };
        if (parsed.message) detail = `: ${parsed.message}`;
      } catch {
        detail = body ? `: ${body.slice(0, 150)}` : "";
      }
      throw new Error(`WordPress publish failed [${res.status}]${detail}`);
    }
  }
  if (!res.ok) {
    const body = await res.text();
    let detail = "";
    try {
      const parsed = JSON.parse(body) as { message?: string };
      if (parsed.message) detail = `: ${parsed.message}`;
    } catch {
      detail = body ? `: ${body.slice(0, 150)}` : "";
    }
    if (res.status === 401) {
      throw new Error(`WordPress publishing unauthorized (HTTP 401)${detail}. Check that your Application Password has not expired or been revoked.`);
    }
    if (res.status === 403) {
      throw new Error(`WordPress publishing denied (HTTP 403)${detail}. Ensure this WordPress user account has permission to publish posts (Administrator or Editor).`);
    }
    throw new Error(`WordPress publish failed [${res.status}]${detail}`);
  }

  const post = (await res.json()) as { id?: number; link?: string };
  if (!post.id) throw new Error("WordPress did not return a post ID.");
  return { wpPostId: post.id, url: post.link ?? "", featuredImageUrl: featured?.url ?? null };
}

export async function getSiteForTenant(
  supabase: RlsClient,
  siteId: string,
): Promise<{ id: string; tenant_id: string } | null> {
  const { data } = await (
    supabase.from("wordpress_sites") as never as {
      select: (cols: string) => {
        eq: (
          col: string,
          val: string,
        ) => { maybeSingle: () => Promise<{ data: { id: string; tenant_id: string } | null }> };
      };
    }
  )
    .select("id, tenant_id")
    .eq("id", siteId)
    .maybeSingle();
  return data ?? null;
}
