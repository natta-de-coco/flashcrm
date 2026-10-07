import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Vision analysis over up to 4 images (data URLs, downscaled client-side). */
export const analyzeImagesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        images: z.array(z.string().startsWith("data:image/")).min(1).max(4),
        hint: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { analyzeImages } = await import("@/lib/seo.server");
    return analyzeImages(data.images, data.hint ?? "");
  });

const DraftSchema = z.object({
  primaryKeyword: z.string().min(2).max(120),
  industry: z.string().max(120),
  intent: z.string().max(40),
  tone: z.string().max(40),
  visionSummary: z.string().max(2000).optional(),
  secondaryKeywords: z.array(z.string().max(80)).max(10).optional(),
});

/** Generates a full long-form SEO article draft with Flas AI. */
export const generateDraftFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DraftSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { generateArticleDraft } = await import("@/lib/seo.server");
    return generateArticleDraft(context.supabase as never, {
      primaryKeyword: data.primaryKeyword,
      industry: data.industry,
      intent: data.intent,
      tone: data.tone,
      visionSummary: data.visionSummary ?? "",
      secondaryKeywords: data.secondaryKeywords ?? [],
    });
  });

/** Generates omnichannel micro-posts (Meta / LinkedIn / TikTok). */
export const generateMicroPostsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DraftSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { generateMicroPosts } = await import("@/lib/seo.server");
    return generateMicroPosts(context.supabase as never, {
      primaryKeyword: data.primaryKeyword,
      industry: data.industry,
      intent: data.intent,
      tone: data.tone,
      visionSummary: data.visionSummary ?? "",
      secondaryKeywords: data.secondaryKeywords ?? [],
    });
  });

/** One-click human-tone rewrite of the article body. */
export const humanizeFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ contentHtml: z.string().min(20).max(100_000), tone: z.string().max(40) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { humanizeHtml } = await import("@/lib/seo.server");
    const { data: tenantId } = await context.supabase.rpc("current_tenant_id");
    return {
      contentHtml: await humanizeHtml(data.contentHtml, data.tone, tenantId as string | null),
    };
  });

/** Tests a WordPress connection and fetches live categories/tags. */
export const testWpConnectionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        siteUrl: z.string().url(),
        username: z.string().min(1),
        appPassword: z.string().min(4),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { testWpConnection } = await import("@/lib/seo.server");
    return testWpConnection({
      siteUrl: data.siteUrl,
      username: data.username,
      appPassword: data.appPassword,
    });
  });

/** Publishes (or updates) an article on a connected WordPress site. */
export const publishArticleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        articleId: z.string().uuid(),
        siteId: z.string().uuid(),
        status: z.enum(["draft", "pending", "publish", "future"]),
        featuredImageDataUrl: z.string().startsWith("data:image/").optional(),
        scheduledAt: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { publishToWordPress, getSiteForTenant } = await import("@/lib/seo.server");
    const { logAudit } = await import("@/lib/audit.server");

    // Load the article through the caller's RLS client (proves tenant access).
    const { data: article, error } = await context.supabase
      .from("seo_articles")
      .select(
        "id, tenant_id, title, slug, excerpt, content_html, meta_title, meta_description, wp_post_id",
      )
      .eq("id", data.articleId)
      .maybeSingle();
    if (error) throw error;
    if (!article) throw new Error("Article not found.");
    if (!article.content_html) throw new Error("The article has no content to publish yet.");

    const site = await getSiteForTenant(context.supabase as never, data.siteId);
    if (!site) throw new Error("WordPress site not found for this workspace.");

    const result = await publishToWordPress({
      siteId: data.siteId,
      tenantId: article.tenant_id,
      article: {
        id: article.id,
        title: article.meta_title || article.title,
        slug: article.slug,
        excerpt: article.excerpt,
        contentHtml: article.content_html,
        metaTitle: article.meta_title ?? article.title,
        metaDescription: article.meta_description ?? "",
        wpPostId: article.wp_post_id,
      } as never,
      status: data.status,
      featuredImageDataUrl: data.featuredImageDataUrl ?? null,
      scheduledAt: data.scheduledAt ?? null,
    });

    const statusMap = {
      draft: "draft",
      pending: "review",
      publish: "published",
      future: "scheduled",
    } as const;
    await context.supabase
      .from("seo_articles")
      .update({
        wp_site_id: data.siteId,
        wp_post_id: result.wpPostId,
        wp_post_url: result.url,
        status: statusMap[data.status],
        ...(result.featuredImageUrl ? { featured_image_url: result.featuredImageUrl } : {}),
      })
      .eq("id", article.id);

    await logAudit({
      action: "seo.article_published",
      tenantId: article.tenant_id,
      actorId: context.userId,
      entityType: "seo_articles",
      entityId: article.id,
      details: { site_id: data.siteId, wp_post_id: result.wpPostId, status: data.status },
    });

    return result;
  });

/** Connects a WordPress site, sealing the application password with AES-256-GCM. */
export const saveWordPressSiteFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        label: z.string().trim().max(100).optional(),
        siteUrl: z.string().trim().url(),
        username: z.string().trim().min(1).max(100),
        appPassword: z.string().trim().min(4).max(200),
        defaultAuthor: z.string().trim().max(100).optional().nullable(),
        seoPlugin: z.enum(["yoast", "rankmath", "seopress", "none"]).default("yoast"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("tenant_id, staff_role")
      .eq("id", context.userId)
      .maybeSingle();
    if (!profile?.tenant_id) throw new Error("Workspace not loaded yet.");
    if (!["company_admin", "super_admin"].includes(profile.staff_role ?? "")) {
      throw new Error("Only company admins can connect WordPress sites.");
    }
    const tenantId = profile.tenant_id;

    const { sealSecret } = await import("@/lib/secret-box.server");
    const sealedPassword = await sealSecret(data.appPassword.replace(/\s+/g, ""));

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("wordpress_sites")
      .insert({
        tenant_id: tenantId,
        label: data.label || data.siteUrl,
        site_url: data.siteUrl.replace(/\/+$/, ""),
        username: data.username,
        app_password: sealedPassword ?? data.appPassword.replace(/\s+/g, ""),
        default_author: data.defaultAuthor || null,
        seo_plugin: data.seoPlugin,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw error;

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "seo.wordpress_site_saved",
      tenantId,
      actorId: context.userId,
      entityType: "wordpress_sites",
      entityId: row.id,
    });
    return { id: row.id };
  });

/** Removes a WordPress site belonging to the caller's workspace. */
export const deleteWordPressSiteFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("tenant_id, staff_role")
      .eq("id", context.userId)
      .maybeSingle();
    if (!profile?.tenant_id) throw new Error("Workspace not loaded yet.");
    if (!["company_admin", "super_admin"].includes(profile.staff_role ?? "")) {
      throw new Error("Only company admins can remove WordPress sites.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("wordpress_sites")
      .delete()
      .eq("id", data.id)
      .eq("tenant_id", profile.tenant_id);
    if (error) throw error;
    return { ok: true };
  });
