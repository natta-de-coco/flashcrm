// Platform error reporting for the manager portal.
//
// Two tables already collect errors and nothing ever read them:
//
//   error_events       — app errors. telemetry.ts installs window.onerror, an
//                        unhandledrejection handler, a fetch wrapper and a
//                        blank-screen detector, and the router error boundary
//                        reports too. Capture has been working; there was no
//                        screen showing any of it.
//   integration_errors — provider failures, already fingerprinted with an
//                        occurrence count, a friendly title, a likely cause and
//                        a recommended fix, written through the
//                        record_integration_error RPC.
//
// Grouping happens here in JavaScript rather than in a SQL view, deliberately.
// A view would mean another migration, and there is already one waiting to be
// applied to production; a reporting screen should not be blocked behind it.
// The row cap below keeps that honest — past it, say so rather than quietly
// summarising a slice.
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

type Client = SupabaseClient<Database>;

/** How many raw rows one request will group. */
const SCAN_LIMIT = 2000;

async function requireSuperAdmin(supabase: Client, userId: string): Promise<void> {
  const { data } = await supabase
    .from("profiles")
    .select("staff_role")
    .eq("id", userId)
    .maybeSingle();
  if (data?.staff_role !== "super_admin") {
    throw new Error("This area is only available to the Flas platform manager");
  }
}

/**
 * Collapses a message into something stable enough to group on.
 *
 * Two reports of the same bug rarely share a byte-identical message: they carry
 * a different row id, a different URL, a different line number. Stripping the
 * parts that vary turns "Failed to load /api/x/9f2c" and "Failed to load
 * /api/x/1ab7" into one group instead of two hundred.
 */
function fingerprint(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\b\d{4,}\b/g, "<n>")
    .replace(/https?:\/\/[^\s"')]+/g, "<url>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

const RangeSchema = z.object({
  days: z.number().int().min(1).max(90).default(7),
  includeResolved: z.boolean().default(false),
});

export type ErrorGroup = {
  fingerprint: string;
  message: string;
  kind: string;
  severity: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  routes: string[];
  releases: string[];
  /** Company names, so the manager can tell "everyone" from "one workspace". */
  companies: string[];
  affectedUsers: number;
  sampleStack: string | null;
};

/**
 * App errors from the browser and the server, grouped by fingerprint.
 *
 * Ordered by how many distinct people hit it rather than raw count: one user
 * in a render loop can produce thousands of rows and is a smaller problem than
 * something twenty customers hit once each.
 */
export const listErrorGroups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RangeSchema.partial().parse(input ?? {}))
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const days = data.days ?? 7;
    const since = new Date(Date.now() - days * 86_400_000).toISOString();

    const { data: rows, error } = await supabaseAdmin
      .from("error_events")
      .select(
        "id, kind, severity, message, stack, route, url, tenant_id, user_id, user_email, release, created_at",
      )
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(SCAN_LIMIT);
    if (error) throw error;

    // Company names, so a group can say who is affected instead of showing
    // opaque tenant ids.
    const tenantIds = [...new Set((rows ?? []).map((r) => r.tenant_id).filter(Boolean))];
    const names = new Map<string, string>();
    if (tenantIds.length > 0) {
      const { data: orgs } = await supabaseAdmin
        .from("organizations")
        .select("id, name")
        .in("id", tenantIds as string[]);
      for (const o of orgs ?? []) names.set(o.id, o.name);
    }

    const groups = new Map<
      string,
      ErrorGroup & {
        _users: Set<string>;
        _routes: Set<string>;
        _rel: Set<string>;
        _orgs: Set<string>;
      }
    >();

    for (const r of rows ?? []) {
      const fp = fingerprint(r.message);
      let g = groups.get(fp);
      if (!g) {
        g = {
          fingerprint: fp,
          message: r.message,
          kind: r.kind,
          severity: r.severity,
          count: 0,
          firstSeen: r.created_at,
          lastSeen: r.created_at,
          routes: [],
          releases: [],
          companies: [],
          affectedUsers: 0,
          sampleStack: r.stack,
          _users: new Set(),
          _routes: new Set(),
          _rel: new Set(),
          _orgs: new Set(),
        };
        groups.set(fp, g);
      }
      g.count += 1;
      if (r.created_at < g.firstSeen) g.firstSeen = r.created_at;
      if (r.created_at > g.lastSeen) g.lastSeen = r.created_at;
      if (!g.sampleStack && r.stack) g.sampleStack = r.stack;
      // "critical" should win over "error" if any single report escalated.
      if (r.severity === "critical") g.severity = "critical";
      if (r.route) g._routes.add(r.route);
      if (r.release) g._rel.add(r.release);
      // Signed-out reports have no user id; count each distinct session as
      // one person so anonymous breakage still registers as breadth.
      if (r.user_id) g._users.add(r.user_id);
      else if (r.id) g._users.add(`anon:${r.id}`);
      if (r.tenant_id) g._orgs.add(names.get(r.tenant_id) ?? r.tenant_id.slice(0, 8));
    }

    const out: ErrorGroup[] = [...groups.values()]
      .map(({ _users, _routes, _rel, _orgs, ...g }) => ({
        ...g,
        affectedUsers: _users.size,
        routes: [..._routes].slice(0, 6),
        releases: [..._rel].slice(0, 4),
        companies: [..._orgs].slice(0, 6),
      }))
      .sort((a, b) => b.affectedUsers - a.affectedUsers || b.count - a.count);

    return {
      groups: out,
      scanned: rows?.length ?? 0,
      /** True when the window held more rows than one request will read. */
      truncated: (rows?.length ?? 0) >= SCAN_LIMIT,
      days,
    };
  });

/**
 * Provider failures — the Meta, Google, TikTok and WhatsApp errors a customer
 * actually sees. Already fingerprinted and counted by the database, and each
 * row carries a likely cause and a recommended fix.
 */
export const listIntegrationErrors = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RangeSchema.partial().parse(input ?? {}))
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const days = data.days ?? 7;
    const since = new Date(Date.now() - days * 86_400_000).toISOString();

    let q = supabaseAdmin
      .from("integration_errors")
      .select(
        "id, tenant_id, platform, feature, operation, http_status, provider_code, provider_message, friendly_title, friendly_message, likely_cause, recommended_fix, severity, retryable, occurrence_count, first_seen, last_seen, resolved_at",
      )
      .gte("last_seen", since)
      .order("occurrence_count", { ascending: false })
      .limit(300);
    if (!data.includeResolved) q = q.is("resolved_at", null);

    const { data: rows, error } = await q;
    if (error) throw error;

    const tenantIds = [...new Set((rows ?? []).map((r) => r.tenant_id))];
    const names = new Map<string, string>();
    if (tenantIds.length > 0) {
      const { data: orgs } = await supabaseAdmin
        .from("organizations")
        .select("id, name")
        .in("id", tenantIds);
      for (const o of orgs ?? []) names.set(o.id, o.name);
    }

    return (rows ?? []).map((r) => ({
      ...r,
      company: names.get(r.tenant_id) ?? r.tenant_id.slice(0, 8),
    }));
  });

/** Marks a provider error handled, so the list shows what is still outstanding. */
export const resolveIntegrationError = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), resolved: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("integration_errors")
      .update({ resolved_at: data.resolved ? new Date().toISOString() : null })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
