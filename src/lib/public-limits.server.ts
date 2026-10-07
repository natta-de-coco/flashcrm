// Throttles and replay protection for the endpoints anyone on the internet can
// call: the website widget, public lead collection, and the platform webhooks.
//
// A site key lives in public website code and a webhook signature can be
// replayed byte-for-byte, so "the caller proved who they are" is not the same
// as "this request should be done again". Each limit below counts the rows the
// work would create, using columns and indexes that already exist — there is no
// new table and no migration, so this protects the live site as soon as it
// deploys.
import { createHash } from "node:crypto";

export type LimitDecision = { ok: true } | { ok: false; retryAfterSeconds: number; error: string };

const ok: LimitDecision = { ok: true };

/** Counts rows written in a window, cheaply, without fetching them. */
async function countSince(
  table: string,
  since: Date,
  filters: Record<string, string>,
): Promise<number | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let query = supabaseAdmin.from(table).select("id", { count: "exact", head: true });
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  const { count, error } = await query.gte("created_at", since.toISOString());
  if (error) {
    // A limiter that cannot count must not become an outage: log it and let the
    // request through. Every other check on the request still applies.
    console.error("[limits] could not count", table, error.message);
    return null;
  }
  return count ?? 0;
}

const ago = (seconds: number) => new Date(Date.now() - seconds * 1000);

/**
 * Widget chat. Each message can cost an AI call and a database write, so the
 * two ways to abuse it are both capped: hammering one conversation, and
 * rotating session ids to look like a crowd of new visitors.
 */
export const WIDGET_MESSAGES_PER_MINUTE = 12;
export const WIDGET_NEW_SESSIONS_PER_5_MIN = 20;

export async function widgetChatAllowed(args: {
  tenantId: string;
  sessionId: string;
}): Promise<LimitDecision> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const tooMany = {
    ok: false as const,
    retryAfterSeconds: 60,
    error: "Too many messages just now. Please wait a moment and send it again.",
  };

  const { data: conversation } = await supabaseAdmin
    .from("conversations")
    .select("id")
    .eq("web_session_id", args.sessionId)
    .eq("tenant_id", args.tenantId)
    .maybeSingle();

  if (conversation) {
    const inSession = await countSince("messages", ago(60), { conversation_id: conversation.id });
    if (inSession !== null && inSession >= WIDGET_MESSAGES_PER_MINUTE) return tooMany;
    return ok;
  }

  // No conversation yet: this request would start one. Cap how many a single
  // site can start, so a bot cannot spend the workspace's AI budget by using a
  // fresh session id for every message.
  const newSessions = await countSince("conversations", ago(5 * 60), {
    tenant_id: args.tenantId,
    channel: "web",
  });
  if (newSessions !== null && newSessions >= WIDGET_NEW_SESSIONS_PER_5_MIN) {
    return { ...tooMany, retryAfterSeconds: 300 };
  }
  return ok;
}

/**
 * Public lead collection (the widget form, the plugin, and the platform
 * webhooks). A valid site key is not a licence to write an unlimited number of
 * leads: past these caps the site is either broken or being used as a spam
 * cannon, and either way the workspace should not be filled with it.
 */
export const LEADS_PER_MINUTE_PER_SITE = 20;
export const LEADS_PER_HOUR_PER_SITE = 200;

export async function leadIntakeAllowed(args: {
  tenantId: string;
  siteId: string;
}): Promise<LimitDecision> {
  const filters = { tenant_id: args.tenantId, site_id: args.siteId };
  const lastMinute = await countSince("leads", ago(60), filters);
  if (lastMinute !== null && lastMinute >= LEADS_PER_MINUTE_PER_SITE) {
    return {
      ok: false,
      retryAfterSeconds: 60,
      error: "Too many submissions from this site in the last minute.",
    };
  }
  const lastHour = await countSince("leads", ago(60 * 60), filters);
  if (lastHour !== null && lastHour >= LEADS_PER_HOUR_PER_SITE) {
    return {
      ok: false,
      retryAfterSeconds: 3600,
      error: "This site has reached its hourly submission limit.",
    };
  }
  return ok;
}

/**
 * The id under which a webhook delivery is remembered: the hash of the body
 * the signature was checked against, and nothing else.
 *
 * A delivery id sent in a header (X-Shopify-Webhook-Id, X-Flas-Event-Id) used
 * to be preferred to it. No signature these endpoints verify covers a header,
 * so that id was whatever the sender chose: a captured request could be sent
 * again with a new id each time and was taken in each time. Only the body is
 * proven to come from the holder of the secret, so only the body can say which
 * delivery this is.
 */
export function webhookEventId(rawBody: string): string {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

/**
 * Records a delivery and says whether it is the first time we have seen it.
 * The unique primary key on (event_source, event_id) is what makes this safe
 * when two copies of the same delivery arrive at the same moment.
 */
export async function firstTimeSeen(source: string, eventId: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("webhook_dedup")
    .insert({ event_source: source, event_id: eventId });
  if (!error) return true;
  if (error.code === "23505") return false;
  // Any other failure must not drop a real lead: carry on and accept it.
  console.error("[limits] could not record webhook delivery", source, error.code ?? "");
  return true;
}
