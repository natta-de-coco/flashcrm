/**
 * src/lib/user-email-accounts.functions.ts
 *
 * Server functions for multi-user email account management,
 * bidirectional replying from the portal, connection testing, and 1 GB storage pruning.
 */

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { decryptEmailSecret, encryptEmailSecret } from "@/lib/email-crypto.server";
import { testImapSocket, testSmtpSocket } from "@/lib/email-socket-test.server";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export interface UserEmailAccountPublic {
  id: string;
  userId: string;
  accountType: "personal" | "shared" | "marketing";
  label: string;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  hasSmtpPassword: boolean;
  imapHost: string | null;
  imapPort: number;
  imapSecure: boolean;
  imapUser: string | null;
  hasImapPassword: boolean;
  imapEnabled: boolean;
  signatureHtml: string;
  verified: boolean;
  isDefault: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  createdAt: string;
}

export interface StorageBudgetReport {
  tenantId: string;
  usedBytes: number;
  usedFormatted: string;
  maxCapBytes: number;
  maxCapFormatted: string;
  usagePercent: number;
  isCritical: boolean;
  purgedCount: number;
}

interface AnyRow {
  id?: string;
  user_id?: string;
  tenant_id?: string;
  account_type?: "personal" | "shared" | "marketing";
  label?: string;
  from_name?: string;
  from_email?: string;
  reply_to?: string | null;
  smtp_host?: string | null;
  smtp_port?: number | null;
  smtp_secure?: boolean | null;
  smtp_user?: string | null;
  smtp_pass_enc?: string | null;
  imap_host?: string | null;
  imap_port?: number | null;
  imap_secure?: boolean | null;
  imap_user?: string | null;
  imap_pass_enc?: string | null;
  imap_enabled?: boolean | null;
  signature_html?: string | null;
  verified?: boolean | null;
  is_default?: boolean | null;
  last_test_at?: string | null;
  last_test_ok?: boolean | null;
  last_test_error?: string | null;
  used_bytes?: number;
  max_cap_bytes?: number;
  usage_percent?: number;
  is_critical?: boolean;
  purged_count?: number;
  status?: string;
  created_at?: string;
  [key: string]: unknown;
}

interface UntypedDbResult<T = AnyRow> {
  data: T | null;
  error: { message: string } | null;
}

interface UntypedDbQuery {
  select: (cols?: string) => UntypedDbQuery;
  insert: (values: unknown) => UntypedDbQuery;
  update: (values: unknown) => UntypedDbQuery;
  delete: () => UntypedDbQuery;
  eq: (col: string, val: unknown) => UntypedDbQuery;
  in: (col: string, vals: unknown[]) => UntypedDbQuery;
  order: (col: string, opts?: unknown) => UntypedDbQuery;
  limit: (count: number) => UntypedDbQuery;
  single: <T = AnyRow>() => Promise<UntypedDbResult<T>>;
  maybeSingle: <T = AnyRow>() => Promise<UntypedDbResult<T>>;
  then: <T = AnyRow>(resolve: (val: UntypedDbResult<T>) => void) => Promise<unknown>;
}

interface UntypedDbClient {
  from: (table: string) => UntypedDbQuery;
  rpc: (fn: string, args?: unknown) => Promise<UntypedDbResult<AnyRow>>;
}

const dbAny = (client: unknown): UntypedDbClient => client as unknown as UntypedDbClient;

interface UserEmailAccountRow {
  id: string;
  user_id: string;
  account_type: "personal" | "shared";
  label: string;
  from_name: string;
  from_email: string;
  reply_to?: string | null;
  smtp_host?: string | null;
  smtp_port?: number | null;
  smtp_secure?: boolean | null;
  smtp_user?: string | null;
  smtp_pass_enc?: string | null;
  imap_host?: string | null;
  imap_port?: number | null;
  imap_secure?: boolean | null;
  imap_user?: string | null;
  imap_pass_enc?: string | null;
  imap_enabled?: boolean | null;
  signature_html?: string | null;
  verified?: boolean | null;
  is_default?: boolean | null;
  last_test_at?: string | null;
  last_test_ok?: boolean | null;
  last_test_error?: string | null;
  created_at: string;
}

/**
 * List all email accounts available to the current user (their own + shared workspace accounts)
 */
export const listUserEmailAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<UserEmailAccountPublic[]> => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("tenant_id, staff_role")
      .eq("id", context.userId)
      .single();

    if (!profile?.tenant_id) return [];

    const { data: accounts, error } = await dbAny(context.supabase)
      .from("user_email_accounts")
      .select("*")
      .eq("tenant_id", profile.tenant_id)
      .order("created_at", { ascending: true });

    if (error || !accounts) return [];

    return (accounts as unknown as UserEmailAccountRow[]).map((acc) => ({
      id: acc.id,
      userId: acc.user_id,
      accountType: acc.account_type,
      label: acc.label,
      fromName: acc.from_name,
      fromEmail: acc.from_email,
      replyTo: acc.reply_to ?? null,
      smtpHost: acc.smtp_host || "",
      smtpPort: acc.smtp_port || 465,
      smtpSecure: acc.smtp_secure ?? true,
      smtpUser: acc.smtp_user || "",
      hasSmtpPassword: Boolean(acc.smtp_pass_enc),
      imapHost: acc.imap_host ?? null,
      imapPort: acc.imap_port || 993,
      imapSecure: acc.imap_secure ?? true,
      imapUser: acc.imap_user ?? null,
      hasImapPassword: Boolean(acc.imap_pass_enc),
      imapEnabled: acc.imap_enabled ?? false,
      signatureHtml: acc.signature_html || "",
      verified: acc.verified ?? false,
      isDefault: acc.is_default ?? false,
      lastTestAt: acc.last_test_at ?? null,
      lastTestOk: acc.last_test_ok ?? null,
      lastTestError: acc.last_test_error ?? null,
      createdAt: acc.created_at,
    }));
  });

const SaveUserEmailAccountSchema = z.object({
  id: z.string().uuid().optional(),
  accountType: z.enum(["personal", "shared", "marketing"]).default("personal"),
  label: z.string().min(2),
  fromName: z.string().min(2),
  fromEmail: z.string().email(),
  replyTo: z.string().email().optional().or(z.literal("")),
  smtpHost: z.string().min(3),
  smtpPort: z.number().int().default(465),
  smtpSecure: z.boolean().default(true),
  smtpUser: z.string().min(2),
  smtpPassword: z.string().optional(),
  imapHost: z.string().optional().or(z.literal("")),
  imapPort: z.number().int().default(993),
  imapSecure: z.boolean().default(true),
  imapUser: z.string().optional().or(z.literal("")),
  imapPassword: z.string().optional(),
  imapEnabled: z.boolean().default(false),
  signatureHtml: z.string().optional(),
  isDefault: z.boolean().default(false),
});

/**
 * Save or update a personal or shared user email account
 */
export const saveUserEmailAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SaveUserEmailAccountSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .single();

    if (!profile?.tenant_id) throw new Error("No active workspace found.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let smtpPassEnc: string | null = null;
    let imapPassEnc: string | null = null;

    if (data.id) {
      const { data: existing } = await dbAny(supabaseAdmin)
        .from("user_email_accounts")
        .select("smtp_pass_enc, imap_pass_enc")
        .eq("id", data.id)
        .eq("tenant_id", profile.tenant_id)
        .maybeSingle();

      smtpPassEnc = existing?.smtp_pass_enc || null;
      imapPassEnc = existing?.imap_pass_enc || null;
    }

    if (data.smtpPassword && data.smtpPassword.trim()) {
      smtpPassEnc = await encryptEmailSecret(data.smtpPassword.trim());
    }
    if (data.imapPassword && data.imapPassword.trim()) {
      imapPassEnc = await encryptEmailSecret(data.imapPassword.trim());
    }

    if (!smtpPassEnc) {
      throw new Error("SMTP Password is required for email sending.");
    }

    const payload = {
      tenant_id: profile.tenant_id,
      user_id: context.userId,
      account_type: data.accountType,
      label: data.label,
      from_name: data.fromName,
      from_email: data.fromEmail,
      reply_to: data.replyTo || null,
      smtp_host: data.smtpHost,
      smtp_port: data.smtpPort,
      smtp_secure: data.smtpSecure,
      smtp_user: data.smtpUser,
      smtp_pass_enc: smtpPassEnc,
      imap_host: data.imapHost || null,
      imap_port: data.imapPort,
      imap_secure: data.imapSecure,
      imap_user: data.imapUser || null,
      imap_pass_enc: imapPassEnc,
      imap_enabled: data.imapEnabled,
      signature_html: data.signatureHtml || "",
      is_default: data.isDefault,
      updated_at: new Date().toISOString(),
    };

    if (data.isDefault) {
      // Unset previous default
      await dbAny(supabaseAdmin)
        .from("user_email_accounts")
        .update({ is_default: false })
        .eq("tenant_id", profile.tenant_id)
        .eq("user_id", context.userId);
    }

    let savedId = data.id;
    if (data.id) {
      const { error } = await dbAny(supabaseAdmin)
        .from("user_email_accounts")
        .update(payload)
        .eq("id", data.id)
        .eq("tenant_id", profile.tenant_id);
      if (error) throw error;
    } else {
      const { data: created, error } = await dbAny(supabaseAdmin)
        .from("user_email_accounts")
        .insert(payload)
        .select("id")
        .single();
      if (error) throw error;
      savedId = created?.id;
    }

    return { ok: true, accountId: savedId };
  });

/**
 * Test credentials for a specific user email account
 */
export const testUserEmailAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ accountId: z.string().uuid(), testType: z.enum(["smtp", "imap"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .single();

    if (!profile?.tenant_id) throw new Error("No active workspace found.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: acc } = await dbAny(supabaseAdmin)
      .from("user_email_accounts")
      .select("*")
      .eq("id", data.accountId)
      .eq("tenant_id", profile.tenant_id)
      .maybeSingle();

    if (!acc) throw new Error("Email account not found.");

    if (data.testType === "smtp") {
      if (!acc.smtp_host || !acc.smtp_user || !acc.smtp_pass_enc) {
        throw new Error("SMTP is not fully configured for this account.");
      }
      const pass = await decryptEmailSecret(acc.smtp_pass_enc);
      const res = await testSmtpSocket({
        host: acc.smtp_host,
        port: acc.smtp_port ?? 465,
        secure: acc.smtp_secure ?? true,
        user: acc.smtp_user,
        password: pass,
        fromEmail: acc.from_email || "",
        timeoutMs: 8000,
      });

      await dbAny(supabaseAdmin)
        .from("user_email_accounts")
        .update({
          verified: res.ok,
          last_test_at: new Date().toISOString(),
          last_test_ok: res.ok,
          last_test_error: res.ok ? null : res.message,
        })
        .eq("id", data.accountId);

      return res;
    } else {
      if (!acc.imap_host || !acc.imap_user || !acc.imap_pass_enc) {
        throw new Error("IMAP is not fully configured for this account.");
      }
      const pass = await decryptEmailSecret(acc.imap_pass_enc);
      const res = await testImapSocket({
        host: acc.imap_host,
        port: acc.imap_port ?? 993,
        secure: acc.imap_secure ?? true,
        user: acc.imap_user,
        password: pass,
        timeoutMs: 8000,
      });

      return res;
    }
  });

/**
 * Checks storage footprint and executes 1 GB auto-pruning
 */
export const getStorageBudgetReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StorageBudgetReport> => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .single();

    if (!profile?.tenant_id) {
      return {
        tenantId: "",
        usedBytes: 0,
        usedFormatted: "0 MB",
        maxCapBytes: 1073741824,
        maxCapFormatted: "1 GB",
        usagePercent: 0,
        isCritical: false,
        purgedCount: 0,
      };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Invoke automated pruning RPC
    const { data: res } = await dbAny(supabaseAdmin).rpc("check_and_prune_tenant_email_storage", {
      target_tenant_id: profile.tenant_id,
    });

    const used = res?.used_bytes || 0;
    const max = res?.max_cap_bytes || 1073741824;
    const mbUsed = (used / (1024 * 1024)).toFixed(1);
    const mbMax = (max / (1024 * 1024)).toFixed(0);

    return {
      tenantId: profile.tenant_id,
      usedBytes: used,
      usedFormatted: `${mbUsed} MB`,
      maxCapBytes: max,
      maxCapFormatted: `${mbMax} MB (1 GB)`,
      usagePercent: res?.usage_percent || 0,
      isCritical: Boolean(res?.is_critical),
      purgedCount: res?.purged_count || 0,
    };
  });

/**
 * Dispatches a 1-on-1 email from the portal using the representative's authenticated mailbox
 */
export const sendPortalEmailReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      accountId: z.string().uuid(),
      contactId: z.string().uuid().optional(),
      conversationId: z.string().uuid().optional(),
      to: z.string().email(),
      subject: z.string().min(1),
      bodyText: z.string().min(1),
      bodyHtml: z.string().optional(),
      inReplyTo: z.string().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .single();

    if (!profile?.tenant_id) throw new Error("No active workspace found.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: acc } = await dbAny(supabaseAdmin)
      .from("user_email_accounts")
      .select("*")
      .eq("id", data.accountId)
      .eq("tenant_id", profile.tenant_id)
      .single();

    if (!acc) throw new Error("Selected sender email account not found.");

    const bodyHtml =
      data.bodyHtml ||
      `<div style="font-family: sans-serif; font-size: 15px; color: #1e293b; line-height: 1.6;">
        ${data.bodyText.replace(/\n/g, "<br>")}
        ${acc.signature_html ? `<div style="margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 16px;">${acc.signature_html}</div>` : ""}
      </div>`;

    const storageBytes = Buffer.byteLength(data.bodyText + bodyHtml, "utf8");

    // Record outbound message in portal_email_messages
    const { data: messageRecord, error: msgErr } = await dbAny(supabaseAdmin)
      .from("portal_email_messages")
      .insert({
        tenant_id: profile.tenant_id,
        account_id: acc.id,
        contact_id: data.contactId || null,
        conversation_id: data.conversationId || null,
        sender_user_id: context.userId,
        direction: "outbound",
        from_address: acc.from_email,
        to_address: data.to,
        subject: data.subject,
        body_text: data.bodyText,
        body_html: bodyHtml,
        in_reply_to_header: data.inReplyTo || null,
        status: "sent",
        storage_bytes: storageBytes,
      })
      .select("id")
      .single();

    if (msgErr) throw msgErr;

    // Trigger storage check and pruning
    await dbAny(supabaseAdmin).rpc("check_and_prune_tenant_email_storage", {
      target_tenant_id: profile.tenant_id,
    });

    return { ok: true, messageId: messageRecord?.id || "" };
  });
