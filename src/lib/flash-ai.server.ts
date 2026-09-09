// Server-only helpers for Flas AI: campaign drafting, WhatsApp analytics and
// AI recommendations. All tenant data is read through the caller's RLS-scoped
// client; only Meta credentials are read with the admin client.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const FLASH_MODEL = "openai/gpt-5.6-sol";

type RlsClient = {
  from: (table: string) => never;
};

/**
 * Options that turn a bare model call into a metered, tenant-aware one.
 * Optional so the existing call sites keep working unchanged; pass them
 * wherever a tenant is known, which is everywhere behind an authenticated
 * server function.
 */
export type FlashAiOptions = {
  /** Enables per-tenant rate limiting, usage accounting and bring-your-own-key. */
  tenantId?: string | null;
  /** For the usage ledger, so a tenant can see what spent their quota. */
  feature?: string;
  userId?: string | null;
};

/**
 * Convenience for the many AI helpers that already hold an RLS-scoped client.
 * Resolves the caller's tenant so rate limiting and bring-your-own-key apply
 * without threading a tenantId through every signature. A failure here must
 * never block the feature — it degrades to the platform key, unmetered.
 */
export async function resolveTenantId(supabase: unknown): Promise<string | null> {
  // Callers hold several different hand-rolled structural types for the same
  // runtime object, so this duck-types rather than naming a client type.
  const rpc = (supabase as { rpc?: unknown } | null)?.rpc;
  if (typeof rpc !== "function") return null;
  try {
    const { data } = (await (rpc as (fn: string) => Promise<{ data: unknown }>).call(
      supabase,
      "current_tenant_id",
    )) ?? { data: null };
    return typeof data === "string" ? data : null;
  } catch {
    return null;
  }
}

export async function aiOptionsFor(
  supabase: unknown,
  feature: string,
  userId?: string | null,
): Promise<FlashAiOptions> {
  return { tenantId: await resolveTenantId(supabase), feature, userId: userId ?? null };
}

type ResolvedProvider = { provider: string; apiKey: string; url: string; headers: Record<string, string> };

/**
 * Picks whose key pays for this call. A tenant that has pasted their own
 * provider key in Settings should be billed to that key — until now nothing
 * ever read ai_provider_keys, so every tenant silently burned the shared
 * platform key regardless of what they configured.
 */
async function resolveProvider(tenantId: string | null | undefined): Promise<ResolvedProvider> {
  if (tenantId) {
    try {
      const { data } = await supabaseAdmin.rpc("get_tenant_ai_key", { _tenant_id: tenantId });
      const row = Array.isArray(data) ? data[0] : data;
      const provider = (row as { provider?: string } | null)?.provider;
      const apiKey = (row as { api_key?: string } | null)?.api_key;
      if (provider && apiKey) {
        if (provider === "openai") {
          return {
            provider,
            apiKey,
            url: "https://api.openai.com/v1/chat/completions",
            headers: { Authorization: `Bearer ${apiKey}` },
          };
        }
        if (provider === "anthropic") {
          return {
            provider,
            apiKey,
            url: "https://api.anthropic.com/v1/messages",
            headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
          };
        }
        // Unknown provider string — fall through to the platform key rather
        // than guessing an endpoint and failing in a confusing way.
      }
    } catch {
      /* fall back to the platform key */
    }
  }
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("Flas AI is not configured yet — the workspace AI key is missing.");
  return {
    provider: "platform",
    apiKey: key,
    url: "https://ai.gateway.lovable.dev/v1/responses",
    headers: { Authorization: `Bearer ${key}`, "Lovable-API-Key": key },
  };
}

/** Calls the AI provider and returns plain text. */
export async function callFlashAi(
  system: string,
  user: string,
  options: FlashAiOptions = {},
): Promise<string> {
  const { tenantId = null, feature = "ai", userId = null } = options;
  const startedAt = Date.now();

  // Ceiling per tenant. Without this, one authenticated user in a loop is an
  // unbounded bill across advisor / seo / translate / catalog / social.
  if (tenantId) {
    try {
      const { data } = await supabaseAdmin.rpc("check_ai_rate_limit", { _tenant_id: tenantId });
      const row = Array.isArray(data) ? data[0] : data;
      const verdict = row as { allowed?: boolean; reason?: string } | null;
      if (verdict && verdict.allowed === false) {
        throw new Error(
          verdict.reason === "daily"
            ? "This workspace has reached its daily AI limit. It resets in 24 hours."
            : "This workspace has reached its hourly AI limit. Try again shortly.",
        );
      }
    } catch (limitError) {
      // A limit breach must surface; a failure to CHECK the limit must not
      // take the feature down.
      if (limitError instanceof Error && limitError.message.includes("AI limit")) throw limitError;
    }
  }

  const chosen = await resolveProvider(tenantId);

  const body =
    chosen.provider === "openai"
      ? {
          model: "gpt-4o",
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }
      : chosen.provider === "anthropic"
        ? {
            model: "claude-sonnet-5",
            max_tokens: 4096,
            system,
            messages: [{ role: "user", content: user }],
          }
        : {
            model: FLASH_MODEL,
            input: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          };

  const res = await fetch(chosen.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...chosen.headers },
    body: JSON.stringify(body),
  });

  const recordUsage = async (ok: boolean) => {
    if (!tenantId) return;
    try {
      await supabaseAdmin.rpc("record_ai_usage", {
        _tenant_id: tenantId,
        _user_id: userId,
        _feature: feature,
        _provider: chosen.provider,
        _ok: ok,
        _duration_ms: Date.now() - startedAt,
      } as never);
    } catch {
      /* accounting must never break the feature */
    }
  };

  const raw = await res.text();
  if (!res.ok) await recordUsage(false);
  else await recordUsage(true);

  // A tenant's own key failing is their configuration to fix, and saying
  // "Flas AI failed" would send them hunting in the wrong place.
  if (!res.ok && chosen.provider !== "platform") {
    throw new Error(
      `Your ${chosen.provider} API key was rejected (HTTP ${res.status}). Check the key in Settings → AI, or remove it to fall back to the built-in assistant.`,
    );
  }
  if (!res.ok) {
    let message = raw.slice(0, 300);
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: string }; message?: string };
      message = parsed.error?.message ?? parsed.message ?? message;
    } catch {
      /* keep raw snippet */
    }
    if (res.status === 429) {
      throw new Error("Flas AI is busy right now — wait a few seconds and try again.");
    }
    if (res.status === 402) {
      throw new Error(
        "AI credits are exhausted — the workspace owner can top up in Lovable billing settings.",
      );
    }
    throw new Error(`Flas AI request failed [${res.status}]: ${message}`);
  }

  // Each provider returns a different shape; normalize to plain text here so
  // every caller keeps receiving a string regardless of whose key paid.
  const json = JSON.parse(raw) as {
    // Lovable Responses API
    output_text?: string;
    output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>;
    // OpenAI chat completions
    choices?: Array<{ message?: { content?: string } }>;
    // Anthropic messages
    content?: Array<{ type?: string; text?: string }>;
  };

  let text = "";
  if (chosen.provider === "openai") {
    text = (json.choices?.[0]?.message?.content ?? "").trim();
  } else if (chosen.provider === "anthropic") {
    text = (json.content ?? [])
      .filter((part) => part.type === "text" && part.text)
      .map((part) => part.text)
      .join("")
      .trim();
  } else {
    text = (json.output_text ?? "").trim();
    if (!text) {
      for (const item of json.output ?? []) {
        if (item.type !== "message") continue;
        for (const part of item.content ?? []) {
          if (part.type === "output_text" && part.text) text += part.text;
        }
      }
    }
    text = text.trim();
  }

  if (!text) throw new Error("Flas AI returned an empty response — try rephrasing your goal.");
  return text;
}

export type BusinessContext = {
  business_name: string | null;
  industry: string | null;
  description: string | null;
  learned_facts: string | null;
  website_url: string | null;
  qa: unknown;
};

export async function getBusinessContext(supabase: RlsClient): Promise<BusinessContext | null> {
  const { data } = await (
    supabase.from("business_profiles") as never as {
      select: (cols: string) => { maybeSingle: () => Promise<{ data: BusinessContext | null }> };
    }
  )
    .select("business_name, industry, description, learned_facts, website_url, qa")
    .maybeSingle();
  return data ?? null;
}

export type LeadSummary = {
  totalLeads: number;
  consentedLeads: number;
  bySource: Record<string, number>;
  topTags: string[];
  contactsByStage: Record<string, number>;
};

export async function gatherLeadSummary(supabase: RlsClient): Promise<LeadSummary> {
  const { data: leads } = await (
    supabase.from("leads") as never as {
      select: (cols: string) => {
        order: (
          col: string,
          opts: { ascending: boolean },
        ) => {
          limit: (n: number) => Promise<{
            data: Array<{
              source: string;
              tags: string[] | null;
              subscribed: boolean;
              consent_given: boolean;
            }> | null;
          }>;
        };
      };
    }
  )
    .select("source, tags, subscribed, consent_given")
    .order("created_at", { ascending: false })
    .limit(500);

  const { data: contacts } = await (
    supabase.from("contacts") as never as {
      select: (cols: string) => {
        limit: (n: number) => Promise<{ data: Array<{ stage: string }> | null }>;
      };
    }
  )
    .select("stage")
    .limit(500);

  const bySource: Record<string, number> = {};
  const tagCounts = new Map<string, number>();
  let consented = 0;
  for (const lead of leads ?? []) {
    bySource[lead.source] = (bySource[lead.source] ?? 0) + 1;
    if (lead.consent_given || lead.subscribed) consented += 1;
    for (const tag of lead.tags ?? []) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  const contactsByStage: Record<string, number> = {};
  for (const c of contacts ?? []) {
    contactsByStage[c.stage] = (contactsByStage[c.stage] ?? 0) + 1;
  }

  return {
    totalLeads: (leads ?? []).length,
    consentedLeads: consented,
    bySource,
    topTags: [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag]) => tag),
    contactsByStage,
  };
}

export type NumberAnalytics = {
  id: string;
  label: string;
  display_phone: string | null;
  local: { conversations: number; unread: number };
  meta: { ok: boolean; sent: number; delivered: number; error?: string };
};

export type MessagingAnalytics = {
  days: number;
  totals: {
    inbound: number;
    outbound: number;
    botReplies: number;
    agentReplies: number;
    delivered: number;
    read: number;
    failed: number;
  };
  conversations: { open: number; pending: number; closed: number; unreadTotal: number };
  avgFirstResponseMinutes: number | null;
  perNumber: NumberAnalytics[];
};

/**
 * Messaging stats from our own database (always available) plus a best-effort
 * pull of Meta's per-number analytics (requires a token with analytics access).
 */
export async function gatherMessagingAnalytics(
  supabase: RlsClient,
  days = 30,
): Promise<MessagingAnalytics> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data: messages } = await (
    supabase.from("messages") as never as {
      select: (cols: string) => {
        gte: (
          col: string,
          val: string,
        ) => {
          order: (
            col: string,
            opts: { ascending: boolean },
          ) => {
            limit: (n: number) => Promise<{
              data: Array<{
                conversation_id: string;
                direction: string;
                sender: string;
                status: string;
                created_at: string;
              }> | null;
            }>;
          };
        };
      };
    }
  )
    .select("conversation_id, direction, sender, status, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(5000);

  const { data: conversations } = await (
    supabase.from("conversations") as never as {
      select: (cols: string) => Promise<{
        data: Array<{
          id: string;
          status: string;
          unread_count: number;
          wa_number_id: string | null;
        }> | null;
      }>;
    }
  ).select("id, status, unread_count, wa_number_id");

  const rows = messages ?? [];
  const totals = {
    inbound: 0,
    outbound: 0,
    botReplies: 0,
    agentReplies: 0,
    delivered: 0,
    read: 0,
    failed: 0,
  };
  for (const m of rows) {
    if (m.direction === "inbound") totals.inbound += 1;
    else {
      totals.outbound += 1;
      if (m.sender === "bot") totals.botReplies += 1;
      if (m.sender === "agent") totals.agentReplies += 1;
      if (m.status === "delivered") totals.delivered += 1;
      if (m.status === "read") totals.read += 1;
      if (m.status === "failed") totals.failed += 1;
    }
  }

  // Average time from a contact's message to the next reply in the same thread.
  const firstInbound = new Map<string, string>();
  let responseSum = 0;
  let responseCount = 0;
  const answered = new Set<string>();
  for (const m of rows) {
    if (answered.has(m.conversation_id)) continue;
    if (m.direction === "inbound") {
      if (!firstInbound.has(m.conversation_id)) firstInbound.set(m.conversation_id, m.created_at);
    } else {
      const started = firstInbound.get(m.conversation_id);
      if (started) {
        responseSum += new Date(m.created_at).getTime() - new Date(started).getTime();
        responseCount += 1;
        answered.add(m.conversation_id);
      }
    }
  }

  const conv = { open: 0, pending: 0, closed: 0, unreadTotal: 0 };
  const perNumberLocal = new Map<string, { conversations: number; unread: number }>();
  for (const c of conversations ?? []) {
    if (c.status === "open") conv.open += 1;
    else if (c.status === "pending") conv.pending += 1;
    else conv.closed += 1;
    conv.unreadTotal += c.unread_count ?? 0;
    if (c.wa_number_id) {
      const entry = perNumberLocal.get(c.wa_number_id) ?? { conversations: 0, unread: 0 };
      entry.conversations += 1;
      entry.unread += c.unread_count ?? 0;
      perNumberLocal.set(c.wa_number_id, entry);
    }
  }

  const perNumber: NumberAnalytics[] = [];
  // supabaseAdmin bypasses RLS, so the tenant filter has to be explicit here.
  // Without it this returned every tenant's numbers -- their labels, phone
  // numbers and Meta stats -- into whichever tenant happened to open the
  // dashboard, and called the Meta API once per number on the whole platform.
  // Fail closed: no resolvable tenant means no per-number data.
  const tenantId = await resolveTenantId(supabase);
  const { data: numbers } = tenantId
    ? await supabaseAdmin
        .from("wa_numbers")
        .select("id, label, display_phone, phone_number_id, access_token")
        .eq("tenant_id", tenantId)
        .eq("active", true)
    : { data: [] as Array<{
        id: string;
        label: string;
        display_phone: string;
        phone_number_id: string;
        access_token: string;
      }> };

  const end = Math.floor(Date.now() / 1000);
  const start = end - days * 24 * 60 * 60;
  for (const n of numbers ?? []) {
    const local = perNumberLocal.get(n.id) ?? { conversations: 0, unread: 0 };
    const meta: NumberAnalytics["meta"] = { ok: false, sent: 0, delivered: 0 };
    try {
      const url =
        `https://graph.facebook.com/v21.0/${n.phone_number_id}` +
        `?fields=analytics.start(${start}).end(${end}).granularity(DAY)` +
        `&access_token=${encodeURIComponent(n.access_token)}`;
      const res = await fetch(url);
      const json = (await res.json()) as {
        analytics?: { data_points?: Array<{ sent?: number; delivered?: number }> };
        error?: { message?: string };
      };
      if (res.ok && json.analytics) {
        meta.ok = true;
        for (const p of json.analytics.data_points ?? []) {
          meta.sent += p.sent ?? 0;
          meta.delivered += p.delivered ?? 0;
        }
      } else {
        meta.error = json.error?.message ?? `Meta API error ${res.status}`;
      }
    } catch (e) {
      meta.error = e instanceof Error ? e.message : "Meta analytics unavailable";
    }
    perNumber.push({ id: n.id, label: n.label, display_phone: n.display_phone, local, meta });
  }

  return {
    days,
    totals,
    conversations: conv,
    avgFirstResponseMinutes:
      responseCount > 0 ? Math.round(responseSum / responseCount / 60000) : null,
    perNumber,
  };
}
