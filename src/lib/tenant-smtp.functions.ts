import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SELECTABLE_PROVIDERS } from "@/lib/email-providers";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Per-company outbound-email provider configuration.
 *
 * Serverless (Cloudflare Workers / Netlify Edge) forbids raw TCP sockets, so
 * companies plug in an HTTP-based transactional provider instead of raw SMTP:
 *   - resend       (recommended: simplest, generous free tier)
 *   - mailgun      (EU / US regions)
 *   - sendgrid
 *   - postmark
 *
 * The list lives in src/lib/email-providers.ts. AWS SES and an SMTP relay were
 * once offered here too, but email-dispatch.server.ts never had code to send
 * through either, so they are no longer accepted (a company that saved one
 * earlier is told on the settings page and can move to one that sends).
 *
 * The api_key is encrypted at rest in Postgres via pgcrypto (see the migration
 * that creates `tenant_smtp_config`).  It is decrypted only inside a
 * SECURITY DEFINER RPC that runs on the server; the plaintext never travels
 * over the API surface.
 */

const ProviderEnum = z.enum(SELECTABLE_PROVIDERS);

const SettingsSchema = z.object({
  provider: ProviderEnum,
  fromEmail: z.string().email().max(320).nullable().optional(),
  fromName: z.string().max(80).nullable().optional(),
  replyTo: z.string().email().max(320).nullable().optional(),
  region: z.string().max(30).nullable().optional(),
  domain: z.string().max(255).nullable().optional(),
});

async function requireCompanyAdmin(context: {
  supabase: import("@supabase/supabase-js").SupabaseClient;
  userId: string;
}) {
  const { data } = await context.supabase
    .from("profiles")
    .select("tenant_id, staff_role")
    .eq("id", context.userId)
    .maybeSingle();
  if (!data?.tenant_id) throw new Error("No company linked to your account");
  if (!["company_admin", "super_admin"].includes(data.staff_role)) {
    throw new Error("Only company admins can change email settings");
  }
  return data.tenant_id as string;
}

/** Read the current tenant's SMTP settings (never returns the api_key). */
export const getTenantSmtpConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await requireCompanyAdmin(context);
    const { data, error } = await context.supabase
      .from("tenant_smtp_config")
      .select(
        "provider, from_email, from_name, reply_to, region, domain, verified, last_test_at, last_test_ok, last_test_error",
      )
      .eq("tenant_id", tenantId)
      .maybeSingle();
    // Not being able to read the row is not the same as having none. Answering
    // with the platform default here would show a company that saved a provider
    // that cannot send a screen with nothing wrong on it, and Save would then
    // overwrite what it had.
    if (error) throw new Error("Your email settings could not be loaded. Try again in a moment.");
    return (
      data ?? {
        provider: "platform",
        from_email: null,
        from_name: null,
        reply_to: null,
        region: null,
        domain: null,
        verified: false,
        last_test_at: null,
        last_test_ok: null,
        last_test_error: null,
      }
    );
  });

/** Upsert the settings row. Api key is set via a separate call. */
export const saveTenantSmtpConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SettingsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const tenantId = await requireCompanyAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: saveError } = await supabaseAdmin.from("tenant_smtp_config").upsert(
      {
        tenant_id: tenantId,
        provider: data.provider,
        from_email: data.fromEmail ?? null,
        from_name: data.fromName ?? null,
        reply_to: data.replyTo ?? null,
        region: data.region ?? null,
        domain: data.domain ?? null,
        verified: false, // needs re-verification any time settings change
        created_by: context.userId,
      },
      { onConflict: "tenant_id" },
    );
    if (saveError)
      throw new Error("Your email settings could not be saved. Try again in a moment.");

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "settings.smtp_saved",
      actorId: context.userId,
      entityType: "tenant_smtp_config",
      entityId: tenantId,
      details: { provider: data.provider, from_email: data.fromEmail },
    });
    return { ok: true };
  });

/** Encrypt + store the API key.  Never round-tripped back to the client. */
export const setTenantSmtpApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ apiKey: z.string().min(4).max(2048) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireCompanyAdmin(context);
    // Delegates to the pgcrypto-backed RPC — plaintext never leaves the DB.
    const { error } = await context.supabase.rpc("set_tenant_smtp_api_key", {
      _api_key: data.apiKey,
    });
    if (error) throw new Error(error.message);

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "settings.smtp_api_key_rotated",
      actorId: context.userId,
      entityType: "tenant_smtp_config",
      entityId: "self",
      details: {},
    });
    return { ok: true };
  });

/** Send a test email via the configured provider + record the result. */
export const testTenantSmtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ toEmail: z.string().email() }).parse(input))
  .handler(async ({ data, context }) => {
    const tenantId = await requireCompanyAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: config } = await supabaseAdmin
      .from("tenant_smtp_config")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!config) throw new Error("No SMTP config saved yet — save settings first");
    if (config.provider === "platform") {
      return { ok: true, note: "Using platform default; nothing to test." };
    }

    // Reveal api key (server-side only)
    const { data: apiKey } = await supabaseAdmin.rpc("get_tenant_smtp_api_key", {
      _tenant_id: tenantId,
    });
    if (!apiKey) throw new Error("API key not set — paste your provider key first");

    const from = config.from_email ?? "no-reply@flas.mobidigisol.com";
    const fromLabel = config.from_name ? `${config.from_name} <${from}>` : from;

    const { dispatchEmail } = await import("@/lib/email-dispatch.server");
    let result: { ok: boolean; providerId?: string; error?: string };
    try {
      result = await dispatchEmail(config.provider, apiKey as string, {
        from: fromLabel,
        to: data.toEmail,
        subject: `Flas CRM — test email from ${config.provider}`,
        text: `This is a test email dispatched via ${config.provider} at ${new Date().toISOString()}. If you received it, outbound email is working for your company.`,
        region: config.region ?? undefined,
        domain: config.domain ?? undefined,
      });
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : "Unknown provider error" };
    }

    await supabaseAdmin
      .from("tenant_smtp_config")
      .update({
        last_test_at: new Date().toISOString(),
        last_test_ok: result.ok,
        last_test_error: result.error ?? null,
        verified: result.ok ? true : config.verified,
      })
      .eq("tenant_id", tenantId);

    await supabaseAdmin.rpc("log_email_delivery", {
      _tenant_id: tenantId,
      _user_id: context.userId,
      _recipient: data.toEmail,
      _from_address: from,
      _subject: `Flas CRM — test email from ${config.provider}`,
      _template: "test",
      _provider: config.provider,
      _provider_msg_id: result.providerId ?? null,
      _status: result.ok ? "sent" : "failed",
      _error: result.error ?? null,
      _meta: {},
    } as never);

    return result;
  });
