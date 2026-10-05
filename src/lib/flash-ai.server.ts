// Server-only helpers for Flas AI: campaign drafting, WhatsApp analytics and
// AI recommendations. All tenant data is read through the caller's RLS-scoped
// client; only Meta credentials are read with the admin client.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const FLASH_MODEL = "openai/gpt-5.6-sol";

/**
 * The Gemini model a workspace's own Google key is spent on.
 *
 * Named here rather than inline because it is in the request URL, so a wrong
 * value fails as a 404 from Google rather than as anything self-explanatory.
 */
// Google restricts older 2.5 models for new projects. Keep an operator override
// so a provider retirement does not require editing every AI feature.
const GEMINI_MODEL = process.env["FLAS_GOOGLE_MODEL"] || "gemini-3.8-flash";

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
  /**
   * Earlier turns of a conversation, oldest first. The WhatsApp assistant needs
   * them: it answers the thread, not a single question. Without this it had to
   * call the gateway itself, which is how the busiest AI feature in the product
   * ended up outside the ceiling, the usage ledger and bring-your-own-key.
   */
  turns?: Array<{ role: "user" | "assistant"; content: string }>;
  /** Ask for a JSON object rather than prose, where the provider supports it. */
  json?: boolean;
  /** Model for the platform gateway. A workspace's own key uses its provider's default. */
  platformModel?: string;
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

type ResolvedProvider = {
  provider: string;
  /** Which request/response shape `url` speaks. */
  shape?: "responses" | "chat";
  apiKey: string;
  url: string;
  headers: Record<string, string>;
};

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly allowFallback = true,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

function providerFailure(provider: string, status: number): AiProviderError {
  const name = provider === "platform" ? "Built-in Flas AI" : provider;
  const reason =
    status === 401 || status === 403
      ? "could not authenticate or access this model. Check the key and its permissions"
      : status === 404
        ? "could not find the configured model. An administrator must update the model or its access"
        : status === 402 || status === 429
          ? "has reached a credit or rate limit. Check the provider's billing and quota"
          : status >= 500
            ? "is temporarily unavailable. Try again shortly"
            : "could not accept this request. Ask an administrator to check the configuration";
  // Never echo an upstream response: it can include a credential or user data.
  return new AiProviderError(
    `${name} ${reason} (HTTP ${status}).`,
    status !== 400 && status !== 422,
  );
}

async function platformProvider(): Promise<ResolvedProvider | null> {
  const key = process.env["LOVABLE_API_KEY"];
  return key
    ? {
        provider: "platform",
        apiKey: key,
        url: "https://ai.gateway.lovable.dev/v1/responses",
        headers: { Authorization: `Bearer ${key}`, "Lovable-API-Key": key },
      }
    : null;
}

async function savedProvider(
  provider: string,
  storedKey: string,
): Promise<ResolvedProvider | null> {
  const { openSecret } = await import("@/lib/secret-box.server");
  const apiKey = await openSecret(storedKey);
  if (!apiKey) return null;
  if (provider === "openai")
    return {
      provider,
      apiKey,
      url: "https://api.openai.com/v1/chat/completions",
      headers: { Authorization: `Bearer ${apiKey}` },
    };
  if (provider === "anthropic")
    return {
      provider,
      apiKey,
      url: "https://api.anthropic.com/v1/messages",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    };
  if (provider === "google")
    return {
      provider,
      apiKey,
      url: `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      headers: { "x-goog-api-key": apiKey },
    };
  return null;
}

/**
 * Picks whose key pays for this call. A tenant that has pasted their own
 * provider key in Settings should be billed to that key — until now nothing
 * ever read ai_provider_keys, so every tenant silently burned the shared
 * platform key regardless of what they configured.
 */
async function resolveProvider(tenantId: string | null | undefined): Promise<ResolvedProvider> {
  if (tenantId) {
    try {
      const { data, error } = await supabaseAdmin.rpc("get_tenant_ai_key", {
        _tenant_id: tenantId,
      });
      if (error) throw new Error("AI configuration unavailable");
      const row = Array.isArray(data) ? data[0] : data;
      const provider = (row as { provider?: string } | null)?.provider;
      const apiKey = (row as { api_key?: string } | null)?.api_key;
      if (provider && apiKey) {
        const resolved = await savedProvider(provider, apiKey);
        if (resolved) return resolved;
        throw new Error("Saved AI key cannot be used");
      }
    } catch {
      throw new Error(
        "Could not read this workspace's AI key. Ask an administrator to check or replace it.",
      );
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
/** Below the hosting edge's ~100 second request limit, so our message wins. */
export const AI_TIMEOUT_MS = 85_000;

export async function callFlashAi(
  system: string,
  user: string,
  options: FlashAiOptions = {},
): Promise<string> {
  const chosen = await resolveProvider(options.tenantId);
  const candidates = [chosen];
  if (options.tenantId) {
    const { data, error } = await supabaseAdmin.rpc(
      "get_tenant_ai_resilience" as never,
      { _tenant_id: options.tenantId } as never,
    );
    // Missing migration or unreadable settings must not silently enable sharing.
    if (!error && data === true) {
      const { data: keys } = await supabaseAdmin
        .from("ai_provider_keys")
        .select("provider, api_key")
        .eq("tenant_id", options.tenantId)
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(3);
      for (const row of keys ?? []) {
        if (candidates.some((c) => c.provider === row.provider)) continue;
        try {
          const candidate = await savedProvider(row.provider, row.api_key);
          if (candidate) candidates.push(candidate);
        } catch {
          /* An unreadable backup must not stop other configured backups. */
        }
      }
      const platform = await platformProvider();
      if (platform && !candidates.some((c) => c.provider === "platform")) candidates.push(platform);
    }
  }
  const deadline = Date.now() + AI_TIMEOUT_MS;
  let lastFailure: unknown;
  for (let i = 0; i < candidates.length; i++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    // Reserve time for backups and bound the entire operation below the edge limit.
    const timeout = i < candidates.length - 1 ? Math.min(25_000, remaining) : remaining;
    try {
      return await attemptFlashAi(system, user, options, candidates[i]!, timeout);
    } catch (error) {
      lastFailure = error;
      if (!(error instanceof AiProviderError) || !error.allowFallback) throw error;
    }
  }
  throw (
    lastFailure ??
    new AiProviderError("No AI provider completed in time. Please ask a teammate to reply.")
  );
}

/** Runs one provider only, with synthetic input: never hides failure behind a backup. */
export async function testAiProvider(tenantId: string, provider: string): Promise<void> {
  let chosen: ResolvedProvider | null = null;
  if (provider === "platform") chosen = await platformProvider();
  else {
    const { data, error } = await supabaseAdmin
      .from("ai_provider_keys")
      .select("api_key")
      .eq("tenant_id", tenantId)
      .eq("provider", provider)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("Could not read this workspace's AI configuration.");
    if (data) chosen = await savedProvider(provider, data.api_key);
  }
  if (!chosen) throw new Error("No active key is saved for this provider.");
  await attemptFlashAi(
    "You are testing a connection. Reply with OK.",
    "Reply with OK.",
    { tenantId, feature: "ai_health" },
    chosen,
    20_000,
  );
}

async function attemptFlashAi(
  system: string,
  user: string,
  options: FlashAiOptions,
  chosen: ResolvedProvider,
  timeoutMs: number,
): Promise<string> {
  const {
    tenantId = null,
    feature = "ai",
    userId = null,
    turns = [],
    json: wantsJson = false,
    platformModel,
  } = options;
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

  // The platform gateway's Responses endpoint takes one instruction and one
  // question. A conversation, or a required JSON object, needs its chat
  // endpoint instead -- same key, same account, same accounting.
  if (chosen.provider === "platform" && (turns.length > 0 || wantsJson)) {
    chosen.shape = "chat";
    chosen.url = "https://ai.gateway.lovable.dev/v1/chat/completions";
  }

  const jsonFormat = wantsJson ? { response_format: { type: "json_object" } } : {};

  const body =
    chosen.provider === "openai"
      ? {
          model: "gpt-4o",
          messages: [
            { role: "system", content: system },
            ...turns,
            { role: "user", content: user },
          ],
          ...jsonFormat,
        }
      : chosen.provider === "anthropic"
        ? {
            model: "claude-sonnet-5",
            max_tokens: 4096,
            system,
            // Anthropic has no JSON mode; the instruction carries the rule, and
            // every caller that asks for JSON validates what comes back.
            messages: [...turns, { role: "user", content: user }],
          }
        : chosen.provider === "google"
          ? {
              // Gemini has no system role; the instruction is a separate field,
              // and the model is already in the URL.
              systemInstruction: { parts: [{ text: system }] },
              contents: [
                ...turns.map((turn) => ({
                  role: turn.role === "assistant" ? "model" : "user",
                  parts: [{ text: turn.content }],
                })),
                { role: "user", parts: [{ text: user }] },
              ],
              ...(wantsJson ? { generationConfig: { responseMimeType: "application/json" } } : {}),
            }
          : chosen.shape === "chat"
            ? {
                model: platformModel || FLASH_MODEL,
                messages: [
                  { role: "system", content: system },
                  ...turns,
                  { role: "user", content: user },
                ],
                ...jsonFormat,
              }
            : {
                model: FLASH_MODEL,
                input: [
                  { role: "system", content: system },
                  { role: "user", content: user },
                ],
              };

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
    if (!ok) {
      const { recordErrorEvent } = await import("@/lib/telemetry.server");
      await recordErrorEvent({
        kind: "ai_provider",
        message: `AI request failed: ${chosen.provider} (${feature}).`,
        tenantId,
        userId,
        sessionId: `ai:${tenantId}:${chosen.provider}:${feature}`,
        context: { provider: chosen.provider, feature },
      });
    }
  };

  // A bounded wait. There was none, so a slow or stuck provider left the
  // spinner running indefinitely -- the SEO Studio writes a whole article in
  // one call, and those routinely take a minute. The hosting edge drops a
  // request after about 100 seconds with a bare error, so stopping first means
  // the person gets a message that says what happened. The signal also covers
  // reading the body, where a stalled stream would otherwise hang.
  let res: Response;
  let raw: string;
  try {
    res = await fetch(chosen.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...chosen.headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    raw = await res.text();
  } catch (error) {
    await recordUsage(false);
    const name = error instanceof Error ? error.name : "";
    throw new AiProviderError(
      name === "TimeoutError" || name === "AbortError"
        ? "The AI provider did not finish in time. Try again, or ask for a shorter piece."
        : "The AI service could not be reached. Try again in a moment.",
    );
  }
  if (!res.ok) {
    await recordUsage(false);
    throw providerFailure(chosen.provider, res.status);
  }

  // Each provider returns a different shape; normalize to plain text here so
  // every caller keeps receiving a string regardless of whose key paid.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await recordUsage(false);
    throw new AiProviderError("The AI service returned an unreadable response.");
  }
  const json = (parsed ?? {}) as {
    // Lovable Responses API
    output_text?: string;
    output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>;
    // OpenAI chat completions
    choices?: Array<{ message?: { content?: string; refusal?: string }; finish_reason?: string }>;
    // Anthropic messages
    content?: Array<{ type?: string; text?: string }>;
    // Gemini generateContent
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    promptFeedback?: { blockReason?: string };
    stop_reason?: string;
  };

  if (
    json.promptFeedback?.blockReason ||
    json.choices?.[0]?.message?.refusal ||
    json.choices?.[0]?.finish_reason === "content_filter" ||
    json.stop_reason === "refusal" ||
    ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "RECITATION"].includes(
      json.candidates?.[0]?.finishReason ?? "",
    )
  ) {
    await recordUsage(false);
    throw new AiProviderError(
      "The AI provider could not safely answer this request. Ask a teammate to review it.",
      false,
    );
  }

  let text = "";
  try {
    if (chosen.provider === "openai" || chosen.shape === "chat") {
      text = (json.choices?.[0]?.message?.content ?? "").trim();
    } else if (chosen.provider === "anthropic") {
      text = (json.content ?? [])
        .filter((part) => part.type === "text" && part.text)
        .map((part) => part.text)
        .join("")
        .trim();
    } else if (chosen.provider === "google") {
      text = (json.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.text ?? "")
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
  } catch {
    await recordUsage(false);
    throw new AiProviderError("The AI service returned an unreadable response.");
  }
  if (!text) {
    await recordUsage(false);
    throw new AiProviderError("Flas AI returned an empty response — try rephrasing your goal.");
  }
  if (wantsJson) {
    try {
      JSON.parse(text);
    } catch {
      await recordUsage(false);
      throw new AiProviderError("The AI response did not match the required format.");
    }
  }
  await recordUsage(true);
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
  /**
   * People who actually opted in, across website leads AND contacts.
   *
   * This used to count `consent_given || subscribed` over leads alone. Nothing
   * in the product ever sets `subscribed` to false and it defaults to true, so
   * every lead counted as consented -- while a workspace whose only consented
   * person was a contact was told nobody had opted in, and the campaign writer
   * refused to write. Both halves of that are wrong in opposite directions.
   */
  consentedLeads: number;
  /** Consented people who are contacts rather than website leads. */
  consentedContacts: number;
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
        limit: (n: number) => Promise<{
          data: Array<{ stage: string; consent_given: boolean | null }> | null;
        }>;
      };
    }
  )
    .select("stage, consent_given")
    .limit(500);

  const bySource: Record<string, number> = {};
  const tagCounts = new Map<string, number>();
  let consented = 0;
  for (const lead of leads ?? []) {
    bySource[lead.source] = (bySource[lead.source] ?? 0) + 1;
    // consent_given is the record of consent. `subscribed` is a suppression
    // flag that defaults to true and has no writer anywhere in the product, so
    // counting it as consent marked everyone opted in.
    if (lead.consent_given === true && lead.subscribed !== false) consented += 1;
    for (const tag of lead.tags ?? []) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  const contactsByStage: Record<string, number> = {};
  let consentedContacts = 0;
  for (const c of contacts ?? []) {
    contactsByStage[c.stage] = (contactsByStage[c.stage] ?? 0) + 1;
    if (c.consent_given === true) consentedContacts += 1;
  }

  return {
    totalLeads: (leads ?? []).length,
    consentedLeads: consented + consentedContacts,
    consentedContacts,
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
    : {
        data: [] as Array<{
          id: string;
          label: string;
          display_phone: string;
          phone_number_id: string;
          access_token: string;
        }>,
      };

  const end = Math.floor(Date.now() / 1000);
  const start = end - days * 24 * 60 * 60;
  for (const n of numbers ?? []) {
    const local = perNumberLocal.get(n.id) ?? { conversations: 0, unread: 0 };
    const meta: NumberAnalytics["meta"] = { ok: false, sent: 0, delivered: 0 };
    try {
      // Stored tokens may be encrypted; sending the stored value as-is sent
      // ciphertext to Meta. Opened here, and sent as a header rather than in
      // the URL.
      const { openSecret } = await import("@/lib/secret-box.server");
      const token = await openSecret(n.access_token);
      if (!token) throw new Error("This number has no usable access token.");
      const url =
        `https://graph.facebook.com/v21.0/${n.phone_number_id}` +
        `?fields=analytics.start(${start}).end(${end}).granularity(DAY)`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
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
