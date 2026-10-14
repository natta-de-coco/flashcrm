// Declared by hand: the platform_email_config table (migration
// 20261009010000) is not yet in the generated database types.
export type PlatformEmailConfigRow = {
  id: string;
  from_email: string;
  from_name: string;
  smtp_host: string | null;
  smtp_port: number;
  smtp_user: string | null;
  smtp_pass_enc: string | null;
  smtp_secure: boolean;
  imap_host: string | null;
  imap_port: number;
  imap_user: string | null;
  imap_pass_enc: string | null;
  imap_secure: boolean;
  verified: boolean;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_error: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};
export type PlatformEmailConfigInsert = Partial<PlatformEmailConfigRow>;
export type PlatformEmailConfigUpdate = Partial<PlatformEmailConfigRow>;

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
