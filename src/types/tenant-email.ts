/**
 * src/types/tenant-email.ts
 *
 * Types for Tenant BYO Email Marketing Settings, Campaign Templates, and DNS Verification.
 */

export interface TenantSmtpConfigPublic {
  tenantId: string;
  configured: boolean;
  provider: string;
  fromEmail: string;
  fromName: string;
  replyTo: string;
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
  imapEnabled: boolean;
  verified: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  welcomeEmailEnabled: boolean;
  welcomeDiscountCode: string;
  welcomeDiscountPercent: number;
  welcomeSubject: string;
  welcomeBodyHtml: string;
  spfVerified: boolean;
  dkimVerified: boolean;
  dmarcVerified: boolean;
  updatedAt: string | null;
}

export interface TenantSmtpConfigInput {
  fromEmail?: string | undefined;
  fromName?: string | undefined;
  replyTo?: string | undefined;
  smtpHost?: string | undefined;
  smtpPort?: number | undefined;
  smtpSecure?: boolean | undefined;
  smtpUser?: string | undefined;
  smtpPassword?: string | undefined;
  imapHost?: string | undefined;
  imapPort?: number | undefined;
  imapSecure?: boolean | undefined;
  imapUser?: string | undefined;
  imapPassword?: string | undefined;
  imapEnabled?: boolean | undefined;
  welcomeEmailEnabled?: boolean | undefined;
  welcomeDiscountCode?: string | undefined;
  welcomeDiscountPercent?: number | undefined;
  welcomeSubject?: string | undefined;
  welcomeBodyHtml?: string | undefined;
}

export interface CampaignAttachment {
  id: string;
  name: string;
  url: string;
  type: string; // e.g. "image/png", "image/jpeg", "application/pdf"
  size: number;
}

export interface EmailTemplate {
  id: string;
  name: string;
  category: "welcome" | "promotion" | "announcement" | "newsletter";
  description: string;
  subject: string;
  previewText: string;
  defaultImageUrl?: string;
  htmlContent: string;
}

export interface DnsRecordInfo {
  type: "TXT" | "CNAME";
  host: string;
  value: string;
  status: "verified" | "pending" | "missing";
  description: string;
}

export interface DnsVerificationReport {
  domain: string;
  spf: DnsRecordInfo;
  dkim: DnsRecordInfo;
  dmarc: DnsRecordInfo;
  allValid: boolean;
}
