import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";

/** Heartbeat: records that this user is currently active in Flas. */
export const touchPresence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await context.supabase
      .from("profiles")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", context.userId);
    return { ok: true };
  });

/** Manager portal: which companies are online right now, and their activity. */
export const listCompanyPresence = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: me } = await context.supabase
      .from("profiles")
      .select("staff_role")
      .eq("id", context.userId)
      .maybeSingle();
    if (me?.staff_role !== "super_admin") {
      throw new Error("This area is only available to the Flas platform manager");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: people }, { data: activity }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, full_name, email, tenant_id, staff_role, last_seen_at")
        .not("tenant_id", "is", null)
        .order("last_seen_at", { ascending: false, nullsFirst: false })
        .limit(500),
      supabaseAdmin
        .from("audit_log")
        .select("tenant_id, action, actor_label, created_at")
        .order("created_at", { ascending: false })
        .limit(300),
    ]);

    const onlineCutoff = Date.now() - 5 * 60 * 1000;
    const byTenant = new Map<
      string,
      {
        tenantId: string;
        online: number;
        users: number;
        lastSeenAt: string | null;
        activeUsers: { name: string; role: string; lastSeenAt: string | null }[];
        lastActions: { action: string; actor: string | null; at: string }[];
      }
    >();

    for (const p of people ?? []) {
      const tenantId = p.tenant_id as string;
      const entry =
        byTenant.get(tenantId) ??
        {
          tenantId,
          online: 0,
          users: 0,
          lastSeenAt: null,
          activeUsers: [],
          lastActions: [],
        };
      entry.users += 1;
      const seen = p.last_seen_at ? new Date(p.last_seen_at).getTime() : 0;
      if (seen > onlineCutoff) entry.online += 1;
      if (p.last_seen_at && (!entry.lastSeenAt || p.last_seen_at > entry.lastSeenAt)) {
        entry.lastSeenAt = p.last_seen_at;
      }
      if (entry.activeUsers.length < 6) {
        entry.activeUsers.push({
          name: p.full_name ?? p.email ?? "Team member",
          role: p.staff_role,
          lastSeenAt: p.last_seen_at,
        });
      }
      byTenant.set(tenantId, entry);
    }

    for (const a of activity ?? []) {
      if (!a.tenant_id) continue;
      const entry = byTenant.get(a.tenant_id);
      if (!entry || entry.lastActions.length >= 8) continue;
      entry.lastActions.push({
        action: a.action,
        actor: a.actor_label,
        at: a.created_at,
      });
    }

    return { tenants: [...byTenant.values()], serverTime: new Date().toISOString() };
  });

/** Manager portal: full data export for one company (audited). */
export const exportCompanyData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => {
    const data = input as { organizationId?: string };
    if (!data?.organizationId) throw new Error("organizationId is required");
    return { organizationId: data.organizationId };
  })
  .handler(async ({ data, context }) => {
    const { data: me } = await context.supabase
      .from("profiles")
      .select("staff_role")
      .eq("id", context.userId)
      .maybeSingle();
    if (me?.staff_role !== "super_admin") {
      throw new Error("This area is only available to the Flas platform manager");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logAudit } = await import("@/lib/audit.server");

    const grab = async (table: string, columns: string) => {
      const { data: rows } = await supabaseAdmin
        .from(table as never)
        .select(columns)
        .eq("tenant_id", data.organizationId)
        .limit(2000);
      return rows ?? [];
    };

    const [org, contacts, leads, products, socialAccounts, websitePages, invoices] =
      await Promise.all([
        supabaseAdmin.from("organizations").select("*").eq("id", data.organizationId).maybeSingle(),
        grab("contacts", "id, name, phone, email, company, stage, value, tags, created_at"),
        grab("leads", "id, name, email, phone, source, status, lead_score, consent_given, created_at"),
        grab("products", "id, title, sku, price, created_at"),
        grab(
          "social_accounts",
          "id, platform, label, health, connect_method, last_synced_at, created_at",
        ),
        grab("website_pages", "id, url, title, kind, word_count, indexed_at"),
        grab("invoices", "id, invoice_number, customer_name, total, currency, status, created_at"),
      ]);

    await logAudit({
      action: "company.data_export",
      tenantId: data.organizationId,
      actorId: context.userId,
      entityType: "organization",
      entityId: data.organizationId,
      details: { contacts: contacts.length, leads: leads.length },
    });

    return {
      exportedAt: new Date().toISOString(),
      organization: org.data,
      contacts,
      leads,
      products,
      socialAccounts,
      websitePages,
      invoices,
    };
  });
