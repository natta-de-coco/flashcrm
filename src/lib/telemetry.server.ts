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

export async function recordErrorEvent(input: RecordErrorInput): Promise<void> {
  try {
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
