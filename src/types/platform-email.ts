import type { Database } from "@/integrations/supabase/types";

export type PlatformEmailConfigRow =
  Database["public"]["Tables"]["platform_email_config"]["Row"];
export type PlatformEmailConfigInsert =
  Database["public"]["Tables"]["platform_email_config"]["Insert"];
export type PlatformEmailConfigUpdate =
  Database["public"]["Tables"]["platform_email_config"]["Update"];

/**
 * Public representation exposed to the Super Admin UI.
 * Plaintext passwords and ciphertexts are masked out for security.
 */
export interface PlatformEmailConfigPublic {
  id?: string;
  configured: boolean;
  fromEmail: string;
  fromName: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  hasSmtpPassword: boolean;
  smtpPasswordMasked: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUser: string;
  hasImapPassword: boolean;
  imapPasswordMasked: string;
  verified: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  lastTestLatencyMs?: number | null;
  updatedAt: string | null;
}

/**
 * Input payload submitted by the Super Admin UI to update settings.
 * Passwords are submitted in plaintext and encrypted on the server before storage.
 */
export interface SavePlatformEmailConfigInput {
  fromEmail?: string;
  fromName?: string;
  smtpHost: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser: string;
  smtpPassword?: string | null; // Plaintext, encrypted by server
  smtpPass?: string | null; // Alias for UI flexibility
  imapHost?: string | null;
  imapPort?: number | null;
  imapSecure?: boolean;
  imapUser?: string | null;
  imapPassword?: string | null; // Plaintext, encrypted by server
  imapPass?: string | null; // Alias for UI flexibility
}

/**
 * Socket handshake test diagnostic outcome.
 */
export interface PlatformConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  status: string;
  message: string;
  greeting?: string | undefined;
  stepsCompleted?: string[] | undefined;
  steps?: string[] | undefined;
  error?: string | undefined;
}
