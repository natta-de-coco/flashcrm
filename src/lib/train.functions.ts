import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const text = (max: number) => z.string().max(max).nullable().default(null);

const BrandSchema = z.object({
  business_name: text(160),
  description: text(2000),
  industry: text(120),
  niche: text(160),
  website_url: text(300),
  locations: text(600),
  target_countries: text(400),
  target_cities: text(400),
  products_summary: text(2000),
  services_summary: text(2000),
  brands: text(600),
  target_customers: text(1000),
  competitors: text(600),
  usp: text(1000),
  pricing_approach: text(600),
  contact_details: text(600),
  tone: text(300),
  brand_personality: text(300),
  preferred_cta: text(300),
  keywords: text(1000),
  forbidden_words: text(600),
  compliance_rules: text(1000),
  priority_products: text(600),
  avoid_products: text(600),
  seasonal_campaigns: text(800),
  marketing_goals: text(1000),
});

/** Reads the permanent brand knowledge plus website knowledge stats. */
export const getBrandKnowledge = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase;
    const [profile, state, pages] = await Promise.all([
      supabase.from("business_profiles").select("*").maybeSingle(),
      supabase.from("website_sync_state").select("*").maybeSingle(),
      supabase
        .from("website_pages")
        .select("id, url, title, kind, word_count, indexed_at")
        .order("indexed_at", { ascending: false })
        .limit(40),
    ]);
    if (profile.error) throw profile.error;
    return {
      profile: profile.data,
      website: state.data ?? null,
      recentPages: (pages.data ?? []).filter((p) => p.indexed_at === state.data?.last_synced_at),
      websiteReaderReady: Boolean(process.env["FIRECRAWL_API_KEY"]?.trim()),
    };
  });

/** Saves brand knowledge once — Flas reuses it for every future output. */
export const saveBrandKnowledge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BrandSchema.partial().parse(input))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const { data: existing } = await supabase.from("business_profiles").select("id").maybeSingle();
    if (existing) {
      const { error } = await supabase
        .from("business_profiles")
        .update(data as never)
        .eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("business_profiles").insert(data as never);
      if (error) throw error;
    }
    return { ok: true };
  });

/** Indexes the business's own website into Flas's knowledge base. */
export const syncWebsiteNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ siteUrl: z.string().min(4).max(300) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { syncWebsiteKnowledge } = await import("@/lib/website-knowledge.server");
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("tenant_id, staff_role")
      .eq("id", context.userId)
      .maybeSingle();
    if (!profile?.tenant_id || !["company_admin", "super_admin"].includes(profile.staff_role))
      throw new Error("Only your workspace admin can change website knowledge.");
    const client = context.supabase;
    const tenantId = profile.tenant_id;
    const { data: state, error: stateError } = await client
      .from("website_sync_state")
      .select("updated_at")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (stateError) throw new Error("Website reading is temporarily unavailable.");
    const startedAt = new Date().toISOString();
    if (state && Date.now() - Date.parse(state.updated_at) < 60_000)
      throw new Error("Please wait a minute before reading the website again.");
    const claimed = state
      ? await client
          .from("website_sync_state")
          .update({ status: "syncing", updated_at: startedAt })
          .eq("tenant_id", tenantId)
          .eq("updated_at", state.updated_at)
          .select("tenant_id")
          .maybeSingle()
      : await client
          .from("website_sync_state")
          .insert({ tenant_id: tenantId, status: "syncing", updated_at: startedAt })
          .select("tenant_id")
          .maybeSingle();
    if (claimed.error || !claimed.data)
      throw new Error("Website reading is already in progress. Try again shortly.");
    try {
      return await syncWebsiteKnowledge(client, data.siteUrl, tenantId);
    } catch (error) {
      await client
        .from("website_sync_state")
        .update({ status: "error", error: "Website reading did not finish. Please retry." })
        .eq("tenant_id", tenantId)
        .eq("updated_at", startedAt);
      throw error;
    }
  });

/** Flas proposes brand knowledge fields from the indexed website content. */
export const draftBrandFromWebsite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase;
    const { data: pages } = await supabase
      .from("website_pages")
      .select("url, title, kind, summary")
      .order("word_count", { ascending: false })
      .limit(18);
    if (!pages || pages.length === 0) {
      throw new Error("Sync your website first so Flas has something to learn from.");
    }
    const { callFlashAi, aiOptionsFor } = await import("@/lib/flash-ai.server");
    const system = `You are Flas, a brand strategist. From this business's own website content, fill a brand knowledge profile.
Return ONLY JSON with these string keys: description, industry, niche, locations, target_countries, target_cities, products_summary, services_summary, brands, target_customers, usp, pricing_approach, contact_details, tone, brand_personality, preferred_cta, keywords, marketing_goals.
Use only what the website supports. Leave a field as "" when the website does not say. Never invent claims, prices, awards or statistics.`;
    const raw = await callFlashAi(
      system,
      JSON.stringify(pages).slice(0, 20000),
      await aiOptionsFor(supabase, "brand_from_website", context.userId),
    );
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("Flas could not read the website content.");
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, string>;
  });
