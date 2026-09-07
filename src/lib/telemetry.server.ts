// Server-only writer for the Flas error store. Used by the request/function
// middleware and by any server code that wants an incident on the record.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type RecordErrorInput = {
  kind: string;
  severity?: string;
  message: string;
  stack?: string | null;
  route?: string | null;
  url?: string | null;
  userAgent?: string | null;
  sessionId?: string | null;
  tenantId?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  context?: Record<string, unknown>;
};

const RELEASE = "flas-crm";

/** How many identical reports from one session we keep before we stop storing. */
const DUPLICATE_CEILING = 20;
const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;

export async function recordErrorEvent(input: RecordErrorInput): Promise<void> {
  try {
    // reportErrorEvent is unauthenticated on purpose -- a browser must be able
    // to report a crash after its session is gone -- and nothing capped it.
    // The realistic failure is not an attacker but a render loop: one broken
    // component reporting the same error thousands of times a minute, each row
    // up to ~10KB. Past the ceiling we drop the duplicate rather than the
    // report, so the first occurrences are always kept.
    if (input.sessionId) {
      const since = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString();
      const { count } = await supabaseAdmin
        .from("error_events")
        .select("id", { count: "exact", head: true })
        .eq("session_id", input.sessionId)
        .eq("message", input.message.slice(0, 2000))
        .gte("created_at", since);
      if ((count ?? 0) >= DUPLICATE_CEILING) return;
    }

    await supabaseAdmin.from("error_events").insert({
      kind: input.kind.slice(0, 40),
      severity: (input.severity ?? "error").slice(0, 20),
      message: input.message.slice(0, 2000),
      stack: input.stack ? input.stack.slice(0, 8000) : null,
      route: input.route ?? null,
      url: input.url ? input.url.slice(0, 1000) : null,
      user_agent: input.userAgent ?? null,
      session_id: input.sessionId ?? null,
      tenant_id: input.tenantId ?? null,
      user_id: input.userId ?? null,
      user_email: input.userEmail ?? null,
      release: RELEASE,
      context: (input.context ?? {}) as never,
    });
  } catch {
    /* never let telemetry break the request it is describing */
  }
}

/** Resolves the caller from a bearer token so incidents carry user context. */
export async function identifyBearer(authHeader: string | null | undefined): Promise<{
  userId: string | null;
  email: string | null;
  tenantId: string | null;
}> {
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (!token || token.split(".").length !== 3) {
    return { userId: null, email: null, tenantId: null };
  }
  try {
    const { data } = await supabaseAdmin.auth.getUser(token);
    const user = data.user;
    if (!user) return { userId: null, email: null, tenantId: null };
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id, email")
      .eq("id", user.id)
      .maybeSingle();
    return {
      userId: user.id,
      email: profile?.email ?? user.email ?? null,
      tenantId: profile?.tenant_id ?? null,
    };
  } catch {
    return { userId: null, email: null, tenantId: null };
  }
}
