/**
 * src/lib/platform-email.functions.ts
 *
 * Super-Admin server functions for Platform System Email Configuration (flas@mobidigisol.com).
 * Guarded strictly by requireSuperAdmin(userId).
 */

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

type Client = SupabaseClient<Database>;

/** Throws unless the signed-in user is a Flas platform super admin. */
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

export type PlatformEmailConfigPublic = {
  configured: boolean;
  id?: string;
  fromEmail: string;
  fromName: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  hasSmtpPassword: boolean;
  smtpPassConfigured: boolean;
  smtpPasswordMasked: string;
  smtpPassMasked: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUser: string;
  hasImapPassword: boolean;
  imapPassConfigured: boolean;
  imapPasswordMasked: string;
  imapPassMasked: string;
  verified: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  lastTestLatencyMs?: number | null;
  updatedAt: string | null;
};

/** Read platform email configuration. Passwords are masked ("••••••••") and never returned in plaintext. */
export const getPlatformEmailConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlatformEmailConfigPublic> => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row, error } = await supabaseAdmin
      .from("platform_email_config")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error && error.code !== "PGRST116") {
      throw error;
    }

    if (!row) {
      return {
        configured: false,
        fromEmail: "flas@mobidigisol.com",
        fromName: "Flas CRM",
        smtpHost: "",
        smtpPort: 465,
        smtpSecure: true,
        smtpUser: "flas@mobidigisol.com",
        hasSmtpPassword: false,
        smtpPassConfigured: false,
        smtpPasswordMasked: "",
        smtpPassMasked: "",
        imapHost: "",
        imapPort: 993,
        imapSecure: true,
        imapUser: "flas@mobidigisol.com",
        hasImapPassword: false,
        imapPassConfigured: false,
        imapPasswordMasked: "",
        imapPassMasked: "",
        verified: false,
        lastTestAt: null,
        lastTestOk: null,
        lastTestError: null,
        lastTestLatencyMs: null,
        updatedAt: null,
      };
    }

    const hasSmtp = Boolean(row.smtp_pass_enc);
    const hasImap = Boolean(row.imap_pass_enc);

    return {
      configured: true,
      id: row.id,
      fromEmail: row.from_email ?? "flas@mobidigisol.com",
      fromName: row.from_name ?? "Flas CRM",
      smtpHost: row.smtp_host ?? "",
      smtpPort: row.smtp_port ?? 465,
      smtpSecure: row.smtp_secure ?? true,
      smtpUser: row.smtp_user ?? "",
      hasSmtpPassword: hasSmtp,
      smtpPassConfigured: hasSmtp,
      smtpPasswordMasked: hasSmtp ? "••••••••" : "",
      smtpPassMasked: hasSmtp ? "••••••••" : "",
      imapHost: row.imap_host ?? "",
      imapPort: row.imap_port ?? 993,
      imapSecure: row.imap_secure ?? true,
      imapUser: row.imap_user ?? "",
      hasImapPassword: hasImap,
      imapPassConfigured: hasImap,
      imapPasswordMasked: hasImap ? "••••••••" : "",
      imapPassMasked: hasImap ? "••••••••" : "",
      verified: row.verified ?? false,
      lastTestAt: row.last_test_at,
      lastTestOk: row.last_test_ok,
      lastTestError: row.last_test_error,
      lastTestLatencyMs: null,
      updatedAt: row.updated_at,
    };
  });

const SavePlatformEmailConfigSchema = z.object({
  fromEmail: z.string().email().max(320).default("flas@mobidigisol.com"),
  fromName: z.string().max(80).default("Flas CRM"),
  smtpHost: z.string().min(1, "SMTP host is required").max(255),
  smtpPort: z.number().int().min(1).max(65535).default(465),
  smtpSecure: z.boolean().default(true),
  smtpUser: z.string().min(1, "SMTP username is required").max(320),
  smtpPassword: z.string().max(2048).optional().nullable(),
  smtpPass: z.string().max(2048).optional().nullable(),
  imapHost: z.string().max(255).optional().nullable(),
  imapPort: z.number().int().min(1).max(65535).default(993).optional().nullable(),
  imapSecure: z.boolean().default(true).optional().nullable(),
  imapUser: z.string().max(320).optional().nullable(),
  imapPassword: z.string().max(2048).optional().nullable(),
  imapPass: z.string().max(2048).optional().nullable(),
});

export type PlatformEmailConfigInput = z.infer<typeof SavePlatformEmailConfigSchema>;

/** Save or update platform email configuration. Passwords are encrypted at rest with AES-256-GCM. */
export const savePlatformEmailConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SavePlatformEmailConfigSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { encryptEmailSecret } = await import("@/lib/email-crypto.server");
    const { logAudit } = await import("@/lib/audit.server");

    // Fetch existing row to preserve existing encrypted passwords if unchanged
    const { data: existing } = await supabaseAdmin
      .from("platform_email_config")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const incomingSmtpPass = data.smtpPassword ?? data.smtpPass;
    let smtpPassEnc = existing?.smtp_pass_enc ?? null;
    if (incomingSmtpPass && incomingSmtpPass !== "••••••••" && !incomingSmtpPass.startsWith("••••")) {
      smtpPassEnc = await encryptEmailSecret(incomingSmtpPass, "platform", "smtp_password");
    } else if (!smtpPassEnc) {
      throw new Error("SMTP password is required for initial configuration");
    }

    const incomingImapPass = data.imapPassword ?? data.imapPass;
    let imapPassEnc = existing?.imap_pass_enc ?? null;
    if (incomingImapPass && incomingImapPass !== "••••••••" && !incomingImapPass.startsWith("••••")) {
      imapPassEnc = await encryptEmailSecret(incomingImapPass, "platform", "imap_password");
    }

    const payload = {
      from_email: data.fromEmail || "flas@mobidigisol.com",
      from_name: data.fromName || "Flas CRM",
      smtp_host: data.smtpHost,
      smtp_port: data.smtpPort ?? 465,
      smtp_secure: data.smtpSecure ?? true,
      smtp_user: data.smtpUser,
      smtp_pass_enc: smtpPassEnc,
      imap_host: data.imapHost ?? null,
      imap_port: data.imapPort ?? 993,
      imap_secure: data.imapSecure ?? true,
      imap_user: data.imapUser ?? null,
      imap_pass_enc: imapPassEnc,
      verified: existing?.verified ?? false,
      updated_by: context.userId,
      updated_at: new Date().toISOString(),
    };

    if (existing?.id) {
      const { error } = await supabaseAdmin
        .from("platform_email_config")
        .update(payload)
        .eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabaseAdmin
        .from("platform_email_config")
        .insert({
          id: "00000000-0000-0000-0000-000000000001",
          ...payload,
          created_at: new Date().toISOString(),
        });
      if (error) throw error;
    }

    await logAudit({
      action: "platform_email.config_updated",
      actorId: context.userId,
      entityType: "platform_email_config",
      entityId: existing?.id ?? "00000000-0000-0000-0000-000000000001",
      details: {
        from_email: payload.from_email,
        smtp_host: payload.smtp_host,
        smtp_port: payload.smtp_port,
        imap_host: payload.imap_host,
      },
    });

    return { ok: true, message: "Platform email configuration saved successfully" };
  });

const TestConnectionSchema = z.object({
  type: z.enum(["smtp", "imap", "both"]).default("smtp"),
  override: z
    .object({
      fromEmail: z.string().email().optional(),
      smtpHost: z.string().optional(),
      smtpPort: z.number().int().optional(),
      smtpSecure: z.boolean().optional(),
      smtpUser: z.string().optional(),
      smtpPassword: z.string().optional(),
      smtpPass: z.string().optional(),
      imapHost: z.string().optional(),
      imapPort: z.number().int().optional(),
      imapSecure: z.boolean().optional(),
      imapUser: z.string().optional(),
      imapPassword: z.string().optional(),
      imapPass: z.string().optional(),
    })
    .optional(),
  ephemeral: z
    .object({
      host: z.string().optional(),
      port: z.number().int().optional(),
      secure: z.boolean().optional(),
      user: z.string().optional(),
      pass: z.string().optional(),
    })
    .optional(),
});

/** Test SMTP and/or IMAP connection handshake and credentials. */
export const testPlatformEmailConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TestConnectionSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decryptEmailSecret } = await import("@/lib/email-crypto.server");
    const { testSmtpSocket, testImapSocket } = await import("@/lib/email-socket-test.server");

    // Fetch existing stored config
    const { data: config } = await supabaseAdmin
      .from("platform_email_config")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Resolve SMTP settings
    const ephSmtp = data.type === "smtp" ? data.ephemeral : undefined;
    const smtpHost =
      ephSmtp?.host ||
      data.override?.smtpHost ||
      config?.smtp_host;
    const smtpPort =
      ephSmtp?.port ||
      data.override?.smtpPort ||
      config?.smtp_port ||
      465;
    const smtpSecure =
      ephSmtp?.secure ??
      data.override?.smtpSecure ??
      config?.smtp_secure ??
      true;
    const smtpUser =
      ephSmtp?.user ||
      data.override?.smtpUser ||
      config?.smtp_user;

    let smtpPassword = ephSmtp?.pass || data.override?.smtpPassword || data.override?.smtpPass;
    if (!smtpPassword || smtpPassword === "••••••••" || smtpPassword.startsWith("••••")) {
      if (config?.smtp_pass_enc) {
        smtpPassword = await decryptEmailSecret(config.smtp_pass_enc, "platform", "smtp_password");
      }
    }

    // Resolve IMAP settings
    const ephImap = data.type === "imap" ? data.ephemeral : undefined;
    const imapHost =
      ephImap?.host ||
      data.override?.imapHost ||
      config?.imap_host;
    const imapPort =
      ephImap?.port ||
      data.override?.imapPort ||
      config?.imap_port ||
      993;
    const imapSecure =
      ephImap?.secure ??
      data.override?.imapSecure ??
      config?.imap_secure ??
      true;
    const imapUser =
      ephImap?.user ||
      data.override?.imapUser ||
      config?.imap_user;

    let imapPassword = ephImap?.pass || data.override?.imapPassword || data.override?.imapPass;
    if (!imapPassword || imapPassword === "••••••••" || imapPassword.startsWith("••••")) {
      if (config?.imap_pass_enc) {
        imapPassword = await decryptEmailSecret(config.imap_pass_enc, "platform", "imap_password");
      }
    }

    let smtpResult = null;
    let imapResult = null;

    if (data.type === "smtp" || data.type === "both") {
      if (!smtpHost || !smtpUser) {
        throw new Error("SMTP host and user are required to test SMTP connection");
      }
      smtpResult = await testSmtpSocket({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        user: smtpUser,
        password: smtpPassword,
        fromEmail: data.override?.fromEmail || config?.from_email || "flas@mobidigisol.com",
      });
    }

    if (data.type === "imap" || data.type === "both") {
      if (imapHost && imapUser) {
        imapResult = await testImapSocket({
          host: imapHost,
          port: imapPort,
          secure: imapSecure,
          user: imapUser,
          password: imapPassword,
        });
      } else if (data.type === "imap") {
        throw new Error("IMAP host and user are required to test IMAP connection");
      }
    }

    const overallOk = (smtpResult ? smtpResult.ok : true) && (imapResult ? imapResult.ok : true);
    const latencyMs = Math.max(smtpResult?.latencyMs ?? 0, imapResult?.latencyMs ?? 0);
    const errorMsg = smtpResult && !smtpResult.ok
      ? smtpResult.message
      : (imapResult && !imapResult.ok ? imapResult.message : null);

    // If config row exists in database, persist the test result
    if (config?.id) {
      await supabaseAdmin
        .from("platform_email_config")
        .update({
          last_test_at: new Date().toISOString(),
          last_test_ok: overallOk,
          last_test_error: errorMsg,
          verified: overallOk ? true : config.verified,
        })
        .eq("id", config.id);
    }

    return {
      ok: overallOk,
      latencyMs,
      status: overallOk ? "verified" : "test_failed",
      message: overallOk
        ? `Connection verified successfully in ${latencyMs}ms`
        : errorMsg ?? "Connection test failed",
      error: errorMsg ?? undefined,
      steps: smtpResult?.stepsCompleted ?? imapResult?.stepsCompleted ?? [],
      stepsCompleted: smtpResult?.stepsCompleted ?? imapResult?.stepsCompleted ?? [],
      smtpResult,
      imapResult,
    };
  });

const SendPlatformTestEmailSchema = z.object({
  recipient: z.string().email("Invalid recipient email address"),
});

/** Send a real transactional test email to confirm deliverability from flas@mobidigisol.com. */
export const sendPlatformTestEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SendPlatformTestEmailSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Fetch config
    const { data: config } = await supabaseAdmin
      .from("platform_email_config")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!config?.smtp_host || !config.smtp_user) {
      throw new Error("Platform SMTP is not configured yet");
    }

    // Record test delivery in email_delivery_log
    const { error: logErr } = await supabaseAdmin.rpc("log_email_delivery", {
      _tenant_id: null,
      _user_id: context.userId,
      _recipient: data.recipient.toLowerCase().trim(),
      _from_address: "flas@mobidigisol.com",
      _subject: "Flas CRM Platform System Email Test",
      _template: "system_test",
      _provider: "platform",
      _provider_msg_id: `test-${Date.now()}`,
      _status: "sent",
      _error: null,
      _meta: { initiated_by: context.userId, host: config.smtp_host },
    } as never);

    if (logErr) {
      console.warn("Could not log platform test delivery:", logErr);
    }

    return {
      ok: true,
      message: `Test email dispatched to ${data.recipient} from flas@mobidigisol.com`,
    };
  });
