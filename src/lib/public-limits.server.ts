// Throttles and replay protection for the endpoints anyone on the internet can
// call: the website widget, public lead collection, and the platform webhooks.
//
// A site key lives in public website code and a webhook signature can be
// replayed byte-for-byte, so "the caller proved who they are" is not the same
// as "this request should be done again". The widget limits count the rows the
// work creates; the lead limit counts a record it writes itself for every
// submission it lets through. Both use tables, columns and indexes that already
// exist — there is no new table and no migration, so this protects the live
// site as soon as it deploys.
import { createHash } from "node:crypto";

export type LimitDecision =
  | { ok: true }
  | {
      ok: false;
      /** 429: over the limit. 503: the request could not be counted, so it was not let through. */
      status: 429 | 503;
      retryAfterSeconds: number;
      error: string;
    };

const ok: LimitDecision = { ok: true };

/**
 * What a request is told when a limit could not be checked. "Could not count"
 * used to mean "let it through", so the limits were off for exactly as long as
 * the database was struggling. A request that cannot be counted is not let
 * through; the sender is asked to try again shortly.
 */
const unavailable: LimitDecision = {
  ok: false,
  status: 503,
  retryAfterSeconds: 30,
  error: "This could not be accepted just now. Please try again shortly.",
};

/**
 * Counts rows written in a window, cheaply, without fetching them. Null means
 * the database could not say, which every caller must treat as a refusal.
 */
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
 *
 * These two limits still count first and let the chat write afterwards, so
 * messages that arrive at the same moment can each see a count below the limit
 * and all go through. Closing that needs the count and the write to happen in
 * one step inside the database, which is a schema change this file cannot make.
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
    status: 429 as const,
    retryAfterSeconds: 60,
    error: "Too many messages just now. Please wait a moment and send it again.",
  };

  const { data: conversation, error: lookupError } = await supabaseAdmin
    .from("conversations")
    .select("id")
    .eq("web_session_id", args.sessionId)
    .eq("tenant_id", args.tenantId)
    .maybeSingle();
  if (lookupError) {
    // Unchecked, this read as "a new visitor", and the busy-session limit was
    // skipped for a session that may well have been over it.
    console.error("[limits] could not look up the widget session", lookupError.message);
    return unavailable;
  }

  if (conversation) {
    const inSession = await countSince("messages", ago(60), { conversation_id: conversation.id });
    if (inSession === null) return unavailable;
    if (inSession >= WIDGET_MESSAGES_PER_MINUTE) return tooMany;
    return ok;
  }

  // No conversation yet: this request would start one. Cap how many a single
  // site can start, so a bot cannot spend the workspace's AI budget by using a
  // fresh session id for every message.
  const newSessions = await countSince("conversations", ago(5 * 60), {
    tenant_id: args.tenantId,
    channel: "web",
  });
  if (newSessions === null) return unavailable;
  if (newSessions >= WIDGET_NEW_SESSIONS_PER_5_MIN) {
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

/**
 * The audit entry written for every lead submission that is let through, and
 * the thing the limit counts.
 *
 * The limit used to count rows in `leads`. A lead is stored once per email
 * address, so the same address could be submitted for ever — writing to the
 * contact, the lead and the audit log each time — while the count stayed at
 * one. The audit log is append-only, so an entry there is one per submission
 * whatever the submission says. Plugin activation is limited the same way.
 */
export const LEAD_SUBMISSION_ACTION = "lead.submission";

/**
 * Whether a site's recorded submissions leave room in both windows. `own` is
 * how many of the recorded submissions are this request's own: 0 before it has
 * recorded itself, 1 after.
 */
async function leadWindows(
  submissions: Record<string, string>,
  own: 0 | 1,
): Promise<LimitDecision> {
  const [lastMinute, lastHour] = await Promise.all([
    countSince("audit_log", ago(60), submissions),
    countSince("audit_log", ago(60 * 60), submissions),
  ]);
  if (lastMinute === null || lastHour === null) return unavailable;
  if (lastMinute - own >= LEADS_PER_MINUTE_PER_SITE) {
    return {
      ok: false,
      status: 429,
      retryAfterSeconds: 60,
      error: "Too many submissions from this site in the last minute.",
    };
  }
  if (lastHour - own >= LEADS_PER_HOUR_PER_SITE) {
    return {
      ok: false,
      status: 429,
      retryAfterSeconds: 3600,
      error: "This site has reached its hourly submission limit.",
    };
  }
  return ok;
}

/**
 * Decides whether one more lead submission from a site may be taken in, and
 * records it if so.
 *
 * It used to count and then let the caller write, so requests that arrived
 * together all saw the same count and all went through. It now works in three
 * steps: turn the request away if the site is already over (writing nothing),
 * record the submission, then count again with this submission included. A
 * request is let through only if the windows still have room once it has
 * counted itself, so requests arriving together can no longer all pass on the
 * strength of the same earlier count.
 *
 * This is not one atomic step, and it must not be described as one. What it
 * gives, as long as each count reads from the database the record was written
 * to, is that the number let through in a window does not go over the limit.
 * What it costs is that a burst larger than the room left can be turned away
 * as a whole, and the records of those turned away still count until they age
 * out. Admitting exactly up to the limit needs the count and the write in one
 * step inside the database.
 */
export async function leadIntakeAllowed(args: {
  tenantId: string;
  siteId: string;
}): Promise<LimitDecision> {
  const submissions = {
    tenant_id: args.tenantId,
    action: LEAD_SUBMISSION_ACTION,
    entity_id: args.siteId,
  };

  // Already over: nothing is written, so a flood that is being turned away
  // cannot fill the audit log.
  const before = await leadWindows(submissions, 0);
  if (!before.ok) return before;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("audit_log").insert({
    tenant_id: args.tenantId,
    action: LEAD_SUBMISSION_ACTION,
    entity_type: "lead_site",
    entity_id: args.siteId,
  });
  if (error) {
    // A submission that leaves no record is one the limit can never see, so it
    // is not let through.
    console.error("[limits] could not record a lead submission", error.message);
    return unavailable;
  }

  // Counted again, this time with itself included.
  return leadWindows(submissions, 1);
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
 * What happened when a delivery asked to be the one that does the work:
 * "claimed" (it is, and nobody else will be), "duplicate" (somebody already
 * is, or already did), or "unavailable" (the database could not say).
 */
export type DeliveryClaim = "claimed" | "duplicate" | "unavailable";

/**
 * Claims a delivery. The unique primary key on (event_source, event_id) is
 * what makes this safe when two copies of the same delivery arrive at the same
 * moment: only one insert can succeed.
 *
 * A claim is a promise to do the work, not a record that it was done. Whoever
 * holds one must call releaseDelivery if the work does not finish, or the
 * sender's retry is answered "duplicate" for something that never happened.
 */
export async function claimDelivery(source: string, eventId: string): Promise<DeliveryClaim> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("webhook_dedup")
    .insert({ event_source: source, event_id: eventId });
  if (!error) return "claimed";
  if (error.code === "23505") return "duplicate";
  // Any other failure used to be read as "first time, go ahead". Without the
  // claim nothing stops the same delivery being taken in twice, so the caller
  // is told the truth and the sender is asked to send it again.
  console.error("[limits] could not record webhook delivery", source, error.code ?? "");
  return "unavailable";
}

/**
 * Gives a claim back when the work it guarded did not finish, so that the
 * sender's retry can do that work instead of being told it is a repeat.
 * Returns false when the claim could not be removed; it is then still held.
 */
export async function releaseDelivery(source: string, eventId: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("webhook_dedup")
    .delete()
    .eq("event_source", source)
    .eq("event_id", eventId);
  if (!error) return true;
  console.error(
    "[limits] could not give back a webhook delivery claim: a retry of this delivery will be answered as a repeat",
    source,
    error.code ?? "",
  );
  return false;
}
