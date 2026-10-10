# Milestone 1: Super-Admin UI & Transactional Mail Wiring Specification

**Author**: Milestone 1 Explorer 3 (Super-Admin UI & Transactional Mail Wiring)  
**Date**: October 9, 2026  
**Status**: Complete Implementation Plan & Architectural Blueprint  
**Scope**: 
1. Super-Admin panel design in `src/routes/_authenticated/companies.email-settings.tsx` linked from `MANAGER_SECTION` in `src/lib/navigation.ts`.
2. UI requirements: shadcn/Tailwind design, loading skeletons, masked password fields with show/hide toggle, instant "Test Connection" button with latency and status feedback, save button, and locked sender `flas@mobidigisol.com` with explanation.
3. Transactional email wiring map: password resets in `src/lib/otp-resend.functions.ts`, signup OTP in `src/routes/auth.tsx`, workspace invites in `src/lib/onboarding.functions.ts`, and Supabase auth webhook in `src/routes/lovable/email/auth/webhook.ts`.

---

## 1. Executive Summary & Architecture Overview

The Flas CRM dual-tier email architecture requires an uncompromised distinction between:
- **Tier 1 (Platform Super-Admin)**: System-critical transactional operations (password recovery, signup verification, workspace invitations) originating exclusively from `flas@mobidigisol.com`, managed through a dedicated Super-Admin panel in the Manager portal.
- **Tier 2 (Tenant Email Marketing)**: Workspace-level BYO SMTP/IMAP configurations in Workspace Settings (`/settings`), strictly isolated per tenant via Row-Level Security (RLS).

This document establishes the UI blueprint for the Super-Admin panel (`/companies/email-settings`), the navigation linkage from the Manager section, the server function contracts, and the exact transactional email wiring across the codebase.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        SUPER-ADMIN PORTAL                              │
│                /companies/email-settings (Tier 1)                      │
│                                                                        │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │ Locked Sender: flas@mobidigisol.com (Reputation & Brand Isolation)  │ │
│ ├────────────────────────────────────────────────────────────────────┤ │
│ │ SMTP Outbound (Ports 465/587)  │  IMAP Inbound (Port 993)          │ │
│ │ Masked Passwords + Show/Hide   │  Masked Passwords + Show/Hide     │ │
│ │ Instant Test: Latency & Steps  │  Instant Test: Latency & Steps    │ │
│ └────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ (AES-256-GCM Encrypted at Rest)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                  TRANSACTIONAL EMAIL DISPATCH HUBS                     │
│                                                                        │
│ 1. Password Resets (otp-resend.functions.ts -> auth/webhook.ts)       │
│ 2. Signup OTP / Verification (otp-resend.functions.ts -> webhook.ts)   │
│ 3. Workspace Invites (onboarding.functions.ts -> inviteStaff)          │
│ 4. Auth Email Webhook (lovable/email/auth/webhook.ts)                  │
│                                                                        │
│ ──> All senders strictly bound to: "Flas CRM <flas@mobidigisol.com>"   │
│ ──> All events audited to: public.email_delivery_log                   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Navigation & Routing Architecture

### 2.1 Navigation Definition (`src/lib/navigation.ts`)
The sidebar and mobile navigation are driven by `NAV_SECTIONS` and `MANAGER_SECTION` in `src/lib/navigation.ts`. In `src/routes/_authenticated/route.tsx` (line 130), `MANAGER_SECTION` is conditionally appended exclusively when `isSuperAdmin === true`:
```ts
const sections = isSuperAdmin ? [...NAV_SECTIONS, MANAGER_SECTION] : NAV_SECTIONS;
```

To provide immediate discoverability, add a dedicated entry `Platform Email` to `MANAGER_SECTION`:

```ts
export const MANAGER_SECTION: NavSection = {
  title: "Manager",
  items: [
    {
      to: "/companies",
      label: "Companies",
      desc: "All client workspaces",
      icon: Building2,
      keywords: "tenants workspaces clients organizations",
    },
    {
      to: "/companies/email-settings",
      label: "Platform Email",
      desc: "SMTP/IMAP system mail config",
      icon: Mail,
      keywords: "email smtp imap system platform flas mobidigisol transactional",
    },
    {
      to: "/companies/emails",
      label: "Email Log",
      desc: "Global delivery & bounce audit",
      icon: FileText,
      keywords: "delivery log bounces otps attempts email platform",
    },
    {
      to: "/companies/errors",
      label: "Errors & issues",
      desc: "What customers are hitting",
      icon: Bug,
      keywords: "errors issues bugs incidents failures",
    },
  ],
};
```

### 2.2 Manager Sub-Navigation Header (`companies.tsx`)
In addition to the sidebar link, on the main `/companies` page (`src/routes/_authenticated/companies.tsx`), render a top-level quick-action bar or sub-navigation tab strip allowing instant jumping between Manager views:
- **Companies Overview** (`/companies`)
- **Platform System Email** (`/companies/email-settings`)
- **Global Email Log** (`/companies/emails`)
- **Subscribers** (`/companies/subscribers`)
- **Errors & Incidents** (`/companies/errors`)

---

## 3. Super-Admin Email Settings UI Blueprint (`src/routes/_authenticated/companies.email-settings.tsx`)

### 3.1 Route Specification
- **File**: `src/routes/_authenticated/companies.email-settings.tsx`
- **Route Path**: `/_authenticated/companies/email-settings`
- **URL**: `/companies/email-settings`
- **Role Guard**: Guarded at runtime by `isSuperAdmin`. If false or unauthenticated, redirects to `/dashboard` or renders platform manager gate banner.

### 3.2 UI Structure & Component Hierarchy

```
<main className="min-h-0 flex-1 overflow-y-auto p-6">
  │
  ├── 1. Header & Breadcrumbs
  │    ├── Back link to "/companies"
  │    ├── Title: "Platform System Email"
  │    ├── Subtitle: "Platform-wide SMTP & IMAP credentials for transactional emails..."
  │    └── Status Badge (Verified & Active / Unverified / Error) + Last Handshake Latency
  │
  ├── 2. SubNav Tabs Strip
  │    └── Links to [Companies] [Platform Email (active)] [Delivery Log] [Errors & Issues]
  │
  ├── 3. Skeletons (when loading)
  │    └── EmailSettingsSkeleton (smooth layout matching final forms)
  │
  ├── 4. Card: Platform Sender Identity (Locked)
  │    ├── Callout Alert: Why flas@mobidigisol.com is locked (reputation, deliverability, brand)
  │    ├── Locked From Address Input: "flas@mobidigisol.com" with Lock icon
  │    └── From Display Name Input: "Flas CRM"
  │
  ├── 5. Card: Outbound SMTP Configuration
  │    ├── Host Input (e.g. smtp.mobidigisol.com)
  │    ├── Port Input (465, 587, 25) with SSL/TLS / STARTTLS selector
  │    ├── Username Input (e.g. flas@mobidigisol.com)
  │    ├── Masked Password Input + Show/Hide Toggle (Eye/EyeOff) + "Encrypted at Rest" indicator
  │    ├── Instant "Test SMTP Connection" Button
  │    └── Live Latency & Handshake Diagnostic Feedback Card (Latency badge + protocol steps)
  │
  ├── 6. Card: Inbound IMAP Configuration
  │    ├── Host Input (e.g. imap.mobidigisol.com)
  │    ├── Port Input (993, 143) with SSL/TLS selector
  │    ├── Username Input (e.g. flas@mobidigisol.com)
  │    ├── Masked Password Input + Show/Hide Toggle (Eye/EyeOff)
  │    ├── Instant "Test IMAP Connection" Button
  │    └── Live Latency & Mailbox Diagnostic Feedback Card (Latency badge + mailbox status)
  │
  ├── 7. Direct Transactional Test Dispatch Card
  │    ├── Test recipient input (e.g. admin email)
  │    └── "Send Live Transactional Test" button (validates real mail delivery)
  │
  └── 8. Sticky Action Footer
       ├── "Test Both Connections" Button
       ├── "Save Platform Configuration" Button (with spinner and disabled state)
       └── "Discard Changes" Button
```

### 3.3 UI Implementation Blueprint (Code Component)

```tsx
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import {
  getPlatformEmailConfig,
  savePlatformEmailConfig,
  testPlatformEmailConnection,
  sendPlatformTestEmail,
} from "@/lib/platform-email.functions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Inbox,
  Info,
  Loader2,
  Lock,
  Mail,
  RefreshCw,
  Send,
  Server,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/companies/email-settings")({
  head: () => ({
    meta: [
      { title: "Platform System Email — Flas Manager" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PlatformEmailSettingsPage,
});

type PlatformConfigPublic = {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassConfigured: boolean;
  fromEmail: string;
  fromName: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUser: string;
  imapPassConfigured: boolean;
  verified: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  lastTestLatencyMs: number | null;
};

function EmailSettingsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-80" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-40" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-40" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function PlatformEmailSettingsPage() {
  const { isSuperAdmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const fetchConfig = useServerFn(getPlatformEmailConfig);
  const saveConfig = useServerFn(savePlatformEmailConfig);
  const testConn = useServerFn(testPlatformEmailConnection);
  const sendTest = useServerFn(sendPlatformTestEmail);

  // Form State
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState(465);
  const [smtpSecure, setSmtpSecure] = useState(true);
  const [smtpUser, setSmtpUser] = useState("flas@mobidigisol.com");
  const [smtpPass, setSmtpPass] = useState("");
  const [showSmtpPass, setShowSmtpPass] = useState(false);

  const [fromName, setFromName] = useState("Flas CRM");

  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState(993);
  const [imapSecure, setImapSecure] = useState(true);
  const [imapUser, setImapUser] = useState("flas@mobidigisol.com");
  const [imapPass, setImapPass] = useState("");
  const [showImapPass, setShowImapPass] = useState(false);

  // Live Test Diagnostic Feedback
  const [smtpTestResult, setSmtpTestResult] = useState<{
    ok: boolean;
    latencyMs?: number;
    error?: string;
    steps?: string[];
  } | null>(null);

  const [imapTestResult, setImapTestResult] = useState<{
    ok: boolean;
    latencyMs?: number;
    error?: string;
    steps?: string[];
  } | null>(null);

  const [liveTestRecipient, setLiveTestRecipient] = useState("");

  const configQuery = useQuery({
    queryKey: ["platform-email-config"],
    queryFn: () => fetchConfig(),
    enabled: isSuperAdmin,
  });

  // Hydrate form on load
  useEffect(() => {
    if (configQuery.data) {
      const d = configQuery.data as PlatformConfigPublic;
      setSmtpHost(d.smtpHost || "");
      setSmtpPort(d.smtpPort || 465);
      setSmtpSecure(d.smtpSecure ?? true);
      setSmtpUser(d.smtpUser || "flas@mobidigisol.com");
      setFromName(d.fromName || "Flas CRM");
      setImapHost(d.imapHost || "");
      setImapPort(d.imapPort || 993);
      setImapSecure(d.imapSecure ?? true);
      setImapUser(d.imapUser || "flas@mobidigisol.com");
    }
  }, [configQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      saveConfig({
        data: {
          smtpHost,
          smtpPort: Number(smtpPort),
          smtpSecure,
          smtpUser,
          ...(smtpPass ? { smtpPass } : {}),
          fromName,
          imapHost,
          imapPort: Number(imapPort),
          imapSecure,
          imapUser,
          ...(imapPass ? { imapPass } : {}),
        },
      }),
    onSuccess: () => {
      toast.success("Platform email settings saved and credentials encrypted.");
      setSmtpPass("");
      setImapPass("");
      void qc.invalidateQueries({ queryKey: ["platform-email-config"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to save configuration"),
  });

  const testSmtpMutation = useMutation({
    mutationFn: () =>
      testConn({
        data: {
          type: "smtp",
          ephemeral: {
            host: smtpHost,
            port: Number(smtpPort),
            secure: smtpSecure,
            user: smtpUser,
            pass: smtpPass || undefined,
          },
        },
      }),
    onSuccess: (res) => {
      setSmtpTestResult(res);
      if (res.ok) {
        toast.success(`SMTP connected successfully (${res.latencyMs}ms)`);
      } else {
        toast.error(`SMTP handshake failed: ${res.error}`);
      }
      void qc.invalidateQueries({ queryKey: ["platform-email-config"] });
    },
    onError: (e) => {
      const err = e instanceof Error ? e.message : "Connection test failed";
      setSmtpTestResult({ ok: false, error: err });
      toast.error(err);
    },
  });

  const testImapMutation = useMutation({
    mutationFn: () =>
      testConn({
        data: {
          type: "imap",
          ephemeral: {
            host: imapHost,
            port: Number(imapPort),
            secure: imapSecure,
            user: imapUser,
            pass: imapPass || undefined,
          },
        },
      }),
    onSuccess: (res) => {
      setImapTestResult(res);
      if (res.ok) {
        toast.success(`IMAP connected successfully (${res.latencyMs}ms)`);
      } else {
        toast.error(`IMAP handshake failed: ${res.error}`);
      }
      void qc.invalidateQueries({ queryKey: ["platform-email-config"] });
    },
    onError: (e) => {
      const err = e instanceof Error ? e.message : "IMAP test failed";
      setImapTestResult({ ok: false, error: err });
      toast.error(err);
    },
  });

  const sendTestMutation = useMutation({
    mutationFn: () => sendTest({ data: { recipient: liveTestRecipient.trim() } }),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success(`Test email dispatched to ${liveTestRecipient}`);
        setLiveTestRecipient("");
      } else {
        toast.error(`Dispatch failed: ${res.error}`);
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Test email failed"),
  });

  if (!authLoading && !isSuperAdmin) {
    return (
      <main className="grid flex-1 place-items-center p-6">
        <p className="text-sm text-muted-foreground">
          This area is only available to the Flas platform manager.
        </p>
      </main>
    );
  }

  const d = configQuery.data as PlatformConfigPublic | undefined;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-6">
      {/* Top Header & Breadcrumbs */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1 h-7 gap-1 text-xs">
            <Link to="/companies">
              <ArrowLeft className="size-3.5" /> Companies
            </Link>
          </Button>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold tracking-tight">Platform System Email</h1>
            {d?.verified && d?.lastTestOk ? (
              <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 gap-1 border-emerald-500/20">
                <CheckCircle2 className="size-3" /> Connected &amp; Verified
                {d.lastTestLatencyMs ? ` (${d.lastTestLatencyMs}ms)` : ""}
              </Badge>
            ) : d?.lastTestError ? (
              <Badge variant="destructive" className="gap-1">
                <AlertCircle className="size-3" /> Connection Failed
              </Badge>
            ) : (
              <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 gap-1">
                <Clock className="size-3" /> Not Verified
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Configure platform SMTP &amp; IMAP credentials for system transactional emails (password
            resets, OTP verification, workspace invites).
          </p>
        </div>

        {/* Quick Manager Navigation */}
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/companies/emails">
              <Mail className="size-3.5 mr-1" /> Delivery Log
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/companies/errors">
              <Activity className="size-3.5 mr-1" /> Incidents
            </Link>
          </Button>
        </div>
      </div>

      {configQuery.isLoading ? (
        <EmailSettingsSkeleton />
      ) : (
        <div className="space-y-6">
          {/* Card 1: Platform Sender Identity (Locked) */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <ShieldCheck className="size-4 text-brand" />
                    Platform Sender Identity
                  </CardTitle>
                  <CardDescription>
                    Dedicated identity used exclusively for platform system emails.
                  </CardDescription>
                </div>
                <Badge variant="secondary" className="gap-1">
                  <Lock className="size-3 text-muted-foreground" /> Immutable
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert className="bg-muted/40 border-primary/20">
                <Info className="size-4 text-brand" />
                <AlertTitle className="text-xs font-semibold">Reputation &amp; Brand Isolation</AlertTitle>
                <AlertDescription className="text-xs text-muted-foreground">
                  Platform system operations (password resets, signup OTPs, workspace invitations) are
                  strictly bound to <strong>flas@mobidigisol.com</strong>. This protects the core platform's
                  deliverability reputation and guarantees security authenticity. Customer-facing marketing
                  campaigns use workspace-specific BYO credentials configured in Workspace Settings.
                </AlertDescription>
              </Alert>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="fromEmail" className="flex items-center gap-1.5 text-xs font-medium">
                    From Address
                    <Lock className="size-3 text-muted-foreground" />
                  </Label>
                  <Input
                    id="fromEmail"
                    value="flas@mobidigisol.com"
                    disabled
                    readOnly
                    className="bg-muted/60 font-mono text-xs cursor-not-allowed text-muted-foreground"
                  />
                  <span className="text-[11px] text-muted-foreground">
                    Locked to the verified platform domain.
                  </span>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="fromName" className="text-xs font-medium">
                    From Display Name
                  </Label>
                  <Input
                    id="fromName"
                    value={fromName}
                    onChange={(e) => setFromName(e.target.value)}
                    placeholder="Flas CRM"
                    className="text-xs"
                  />
                  <span className="text-[11px] text-muted-foreground">
                    Appears as sender in recipient inboxes (e.g. "Flas CRM").
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Cards 2 & 3: SMTP & IMAP Grid */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* SMTP Outbound Configuration */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Server className="size-4 text-brand" />
                      SMTP Outbound Configuration
                    </CardTitle>
                    <CardDescription>
                      Relays password reset links, signup OTPs, and team invites.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="smtpHost" className="text-xs font-medium">
                      SMTP Host
                    </Label>
                    <Input
                      id="smtpHost"
                      placeholder="smtp.mobidigisol.com"
                      value={smtpHost}
                      onChange={(e) => setSmtpHost(e.target.value)}
                      className="text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="smtpPort" className="text-xs font-medium">
                      Port
                    </Label>
                    <Input
                      id="smtpPort"
                      type="number"
                      value={smtpPort}
                      onChange={(e) => setSmtpPort(Number(e.target.value))}
                      className="text-xs font-mono"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <Label className="text-xs font-medium">Use SSL / TLS</Label>
                    <p className="text-[11px] text-muted-foreground">
                      Port 465 (SSL/TLS implicit) or Port 587 (STARTTLS)
                    </p>
                  </div>
                  <Switch
                    checked={smtpSecure}
                    onCheckedChange={(checked) => {
                      setSmtpSecure(checked);
                      if (checked && smtpPort === 587) setSmtpPort(465);
                      if (!checked && smtpPort === 465) setSmtpPort(587);
                    }}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="smtpUser" className="text-xs font-medium">
                    SMTP Username
                  </Label>
                  <Input
                    id="smtpUser"
                    placeholder="flas@mobidigisol.com"
                    value={smtpUser}
                    onChange={(e) => setSmtpUser(e.target.value)}
                    className="text-xs font-mono"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="smtpPass" className="text-xs font-medium">
                    SMTP Password
                  </Label>
                  <div className="relative">
                    <Input
                      id="smtpPass"
                      type={showSmtpPass ? "text" : "password"}
                      placeholder={d?.smtpPassConfigured ? "•••••••••••••••• (Encrypted at rest)" : "Enter SMTP password"}
                      value={smtpPass}
                      onChange={(e) => setSmtpPass(e.target.value)}
                      className="pr-10 text-xs font-mono"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full w-9 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowSmtpPass(!showSmtpPass)}
                    >
                      {showSmtpPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </Button>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    AES-256-GCM envelope encrypted. Leave blank to retain existing key.
                  </span>
                </div>

                {/* Instant SMTP Handshake Test Button & Feedback */}
                <div className="pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full gap-2"
                    disabled={testSmtpMutation.isPending || !smtpHost}
                    onClick={() => testSmtpMutation.mutate()}
                  >
                    {testSmtpMutation.isPending ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" /> Testing Handshake...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="size-3.5" /> Test SMTP Connection
                      </>
                    )}
                  </Button>

                  {smtpTestResult && (
                    <div
                      className={`mt-3 rounded-lg border p-3 text-xs ${
                        smtpTestResult.ok
                          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
                          : "border-destructive/20 bg-destructive/10 text-destructive"
                      }`}
                    >
                      <div className="flex items-center justify-between font-semibold">
                        <span className="flex items-center gap-1.5">
                          {smtpTestResult.ok ? (
                            <CheckCircle2 className="size-4 text-emerald-600" />
                          ) : (
                            <AlertCircle className="size-4 text-destructive" />
                          )}
                          {smtpTestResult.ok ? "SMTP Handshake Passed" : "SMTP Handshake Failed"}
                        </span>
                        {smtpTestResult.latencyMs !== undefined && (
                          <Badge variant="outline" className="text-[10px]">
                            {smtpTestResult.latencyMs}ms latency
                          </Badge>
                        )}
                      </div>
                      {smtpTestResult.error && (
                        <p className="mt-1 font-mono text-[11px]">{smtpTestResult.error}</p>
                      )}
                      {smtpTestResult.steps && smtpTestResult.steps.length > 0 && (
                        <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                          {smtpTestResult.steps.map((s, i) => (
                            <li key={i} className="flex items-center gap-1">
                              • {s}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* IMAP Inbound Configuration */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Inbox className="size-4 text-brand" />
                      IMAP Inbound Configuration
                    </CardTitle>
                    <CardDescription>
                      Inspects bounces, delivery status receipts, and inbound replies.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="imapHost" className="text-xs font-medium">
                      IMAP Host
                    </Label>
                    <Input
                      id="imapHost"
                      placeholder="imap.mobidigisol.com"
                      value={imapHost}
                      onChange={(e) => setImapHost(e.target.value)}
                      className="text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="imapPort" className="text-xs font-medium">
                      Port
                    </Label>
                    <Input
                      id="imapPort"
                      type="number"
                      value={imapPort}
                      onChange={(e) => setImapPort(Number(e.target.value))}
                      className="text-xs font-mono"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <Label className="text-xs font-medium">Use SSL / TLS</Label>
                    <p className="text-[11px] text-muted-foreground">Port 993 (SSL implicit) or 143</p>
                  </div>
                  <Switch
                    checked={imapSecure}
                    onCheckedChange={(checked) => {
                      setImapSecure(checked);
                      if (checked && imapPort === 143) setImapPort(993);
                      if (!checked && imapPort === 993) setImapPort(143);
                    }}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="imapUser" className="text-xs font-medium">
                    IMAP Username
                  </Label>
                  <Input
                    id="imapUser"
                    placeholder="flas@mobidigisol.com"
                    value={imapUser}
                    onChange={(e) => setImapUser(e.target.value)}
                    className="text-xs font-mono"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="imapPass" className="text-xs font-medium">
                    IMAP Password
                  </Label>
                  <div className="relative">
                    <Input
                      id="imapPass"
                      type={showImapPass ? "text" : "password"}
                      placeholder={d?.imapPassConfigured ? "•••••••••••••••• (Encrypted at rest)" : "Enter IMAP password"}
                      value={imapPass}
                      onChange={(e) => setImapPass(e.target.value)}
                      className="pr-10 text-xs font-mono"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full w-9 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowImapPass(!showImapPass)}
                    >
                      {showImapPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </Button>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    AES-256-GCM envelope encrypted.
                  </span>
                </div>

                {/* Instant IMAP Handshake Test Button & Feedback */}
                <div className="pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full gap-2"
                    disabled={testImapMutation.isPending || !imapHost}
                    onClick={() => testImapMutation.mutate()}
                  >
                    {testImapMutation.isPending ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" /> Testing IMAP Handshake...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="size-3.5" /> Test IMAP Connection
                      </>
                    )}
                  </Button>

                  {imapTestResult && (
                    <div
                      className={`mt-3 rounded-lg border p-3 text-xs ${
                        imapTestResult.ok
                          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
                          : "border-destructive/20 bg-destructive/10 text-destructive"
                      }`}
                    >
                      <div className="flex items-center justify-between font-semibold">
                        <span className="flex items-center gap-1.5">
                          {imapTestResult.ok ? (
                            <CheckCircle2 className="size-4 text-emerald-600" />
                          ) : (
                            <AlertCircle className="size-4 text-destructive" />
                          )}
                          {imapTestResult.ok ? "IMAP Handshake Passed" : "IMAP Handshake Failed"}
                        </span>
                        {imapTestResult.latencyMs !== undefined && (
                          <Badge variant="outline" className="text-[10px]">
                            {imapTestResult.latencyMs}ms latency
                          </Badge>
                        )}
                      </div>
                      {imapTestResult.error && (
                        <p className="mt-1 font-mono text-[11px]">{imapTestResult.error}</p>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Card 4: End-to-End Live Transactional Test Dispatch */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Send className="size-4 text-brand" />
                Live Transactional Test Dispatch
              </CardTitle>
              <CardDescription>
                Send a real system transactional email to an administrator inbox to confirm deliverability.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  type="email"
                  placeholder="admin@example.com"
                  value={liveTestRecipient}
                  onChange={(e) => setLiveTestRecipient(e.target.value)}
                  className="max-w-md text-xs font-mono"
                />
                <Button
                  size="sm"
                  disabled={sendTestMutation.isPending || !liveTestRecipient.trim()}
                  onClick={() => sendTestMutation.mutate()}
                  className="gap-1.5"
                >
                  {sendTestMutation.isPending ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" /> Sending Test...
                    </>
                  ) : (
                    <>
                      <Send className="size-3.5" /> Send Test Email
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Sticky Bottom Actions Bar */}
          <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background/95 p-4 backdrop-blur shadow-sm">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {d?.lastTestAt ? (
                <span>
                  Last tested: {new Date(d.lastTestAt).toLocaleString()} · Latency:{" "}
                  {d.lastTestLatencyMs ?? "—"}ms
                </span>
              ) : (
                <span>Not tested yet</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  testSmtpMutation.mutate();
                  testImapMutation.mutate();
                }}
                disabled={testSmtpMutation.isPending || testImapMutation.isPending}
              >
                Test All Connections
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="gap-1.5"
              >
                {saveMutation.isPending ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" /> Saving...
                  </>
                ) : (
                  <>
                    <ShieldCheck className="size-3.5" /> Save Configuration
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
```

---

## 4. Server Functions Specification (`src/lib/platform-email.functions.ts`)

### 4.1 Interface Contracts
```ts
export type PlatformEmailConfigPublic = {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassConfigured: boolean;
  fromEmail: string; // strictly "flas@mobidigisol.com"
  fromName: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUser: string;
  imapPassConfigured: boolean;
  verified: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  lastTestLatencyMs: number | null;
};
```

### 4.2 Security Guards & AES-256-GCM Envelope Encryption
- **Authorization Guard**: Every server function invokes `requireSuperAdmin(context.supabase, context.userId)`.
- **Encryption Pattern**: Credential passwords are encrypted using WebCrypto AES-256-GCM envelope (`v1:<keyId>:<iv>:<ciphertext>:<tag>`) via `encryptEmailSecret` / `decryptEmailSecret` (from `src/lib/email-crypto.server.ts` or `src/lib/social-secrets.server.ts`).
- **Serverless Socket Handshake Tester**: Socket handshake test via `src/lib/smtp-imap-test.server.ts` executes:
  - SMTP: Connects on port 465/587, measures socket handshake latency, validates code `220`, performs `EHLO`, sends `AUTH LOGIN` credentials, verifies `235`, tests `MAIL FROM:<flas@mobidigisol.com>`.
  - IMAP: Connects on port 993, measures socket handshake latency, validates greeting `* OK`, issues `A001 LOGIN`, checks `A002 SELECT INBOX`.

---

## 5. Transactional Email Wiring Map

The platform currently executes transactional email through 4 major paths. Here is the exact mapping and code adjustments required for complete Milestone 1 binding:

### Call Site 1: Password Resets (`src/lib/otp-resend.functions.ts` & `src/routes/reset-password.tsx`)
1. **Trigger Flow**:
   - User requests password recovery on `/auth` or via `resendVerification({ email, kind: "password_recovery", redirectTo })`.
   - Rate limits enforced via `check_otp_attempt` RPC in PostgreSQL (60s cooldown, 5/hr, 20/day per email; 20/hr per IP).
   - `supabaseAdmin.auth.resetPasswordForEmail(email, { redirectTo })` triggers Supabase Auth.
2. **Transactional Binding**:
   - Supabase Auth invokes the Send Email Hook at `POST /lovable/email/auth/webhook`.
   - Action type: `"recovery"`.
   - Webhook renders `RecoveryEmail` template from `src/lib/email-templates/recovery.tsx`.
   - **Sender Binding**: Sender header is bound to `Flas CRM <flas@mobidigisol.com>`.
   - `log_email_delivery` records event with `_template: "recovery"`, `_from_address: "flas@mobidigisol.com"`, and `_status: "sent"`.

### Call Site 2: Signup OTP & Verification (`src/lib/otp-resend.functions.ts` & `src/routes/auth.tsx`)
1. **Trigger Flow**:
   - New user registers on `/auth` (`supabase.auth.signUp()`), or triggers "Resend verification email" via `resendVerification({ email, kind: "signup_verify" })`.
   - `check_otp_attempt` rate limit verification.
   - `supabaseAdmin.auth.resend({ type: "signup", email })` triggers Supabase Auth.
2. **Transactional Binding**:
   - Supabase Auth dispatches hook to `POST /lovable/email/auth/webhook`.
   - Action type: `"signup"`.
   - Webhook renders `SignupEmail` template from `src/lib/email-templates/signup.tsx`.
   - **Sender Binding**: Sender header bound to `Flas CRM <flas@mobidigisol.com>`.
   - Audited in `otp_attempts` and `auth_email_attempts`.

### Call Site 3: Workspace Invitations (`src/lib/onboarding.functions.ts` & `src/components/settings/TeamCard.tsx`)
1. **Current Codebase Observation**:
   - In `src/lib/onboarding.functions.ts` (lines 177–208), `inviteStaff` inserts a pending record into `team_invites`, but **does NOT dispatch an email**. The invitee has no notification of their invitation unless notified manually.
   - Meanwhile, `src/routes/lovable/email/auth/webhook.ts` already contains a fully designed `invite` template using `src/lib/email-templates/invite.tsx` (`InviteEmail`).
2. **Wiring Specification for Milestone 1**:
   - Extend `inviteStaff` in `src/lib/onboarding.functions.ts` to trigger the invitation dispatch:
     ```ts
     // After inserting into team_invites:
     const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
     const origin = process.env["SITE_URL"] ?? "https://flas.mobidigisol.com";
     
     // Trigger Supabase Auth admin invitation (or direct platform dispatch)
     await supabaseAdmin.auth.admin.inviteUserByEmail(data.email.toLowerCase(), {
       redirectTo: `${origin}/auth`,
       data: {
         invited_to_tenant: me.tenant_id,
         assigned_role: data.staffRole,
       },
     });
     
     // Log transactional delivery
     await supabaseAdmin.rpc("log_email_delivery", {
       _tenant_id: me.tenant_id,
       _user_id: context.userId,
       _recipient: data.email.toLowerCase(),
       _from_address: "flas@mobidigisol.com",
       _subject: "You've been invited to Flas CRM",
       _template: "invite",
       _provider: "platform",
       _provider_msg_id: null,
       _status: "sent",
       _error: null,
       _meta: { staff_role: data.staffRole },
     } as never);
     ```
   - When the user clicks the invite link in their email, they land on `/auth` and complete signup; `claimInvites` in `onboarding.functions.ts` automatically attaches them to the tenant workspace.

### Call Site 4: Auth Email Webhook (`src/routes/lovable/email/auth/webhook.ts`)
1. **Sender Address Update**:
   - In `src/routes/lovable/email/auth/webhook.ts`, update line 49 from:
     ```ts
     from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
     ```
     to:
     ```ts
     from: `${SITE_NAME} <flas@mobidigisol.com>`,
     ```
   - Ensure `from` header strictly matches `flas@mobidigisol.com` across all 6 webhook actions (`signup`, `invite`, `magiclink`, `recovery`, `email_change`, `reauthentication`).
2. **Audit Logging Update**:
   - In `src/lib/auth-email-audit.server.ts`, expand `AuthEmailAction`:
     ```ts
     type AuthEmailAction = "signup" | "recovery" | "invite" | "magiclink" | "email_change" | "reauth";
     ```
   - This records all platform auth email events with delivery status in `auth_email_attempts`.

### Call Site 5: Delivery Log View (`src/routes/_authenticated/companies.emails.tsx`)
- All platform transactional deliveries logged via `log_email_delivery` are immediately visible to Super-Admin at `/companies/emails`.
- Shows recipient, sender (`flas@mobidigisol.com`), template (`signup`, `recovery`, `invite`), status (`sent`, `delivered`, `bounced`), and error details.

---

## 6. Concrete File Modification Plan for Implementers

| File | Change Nature | Key Modifications |
|---|---|---|
| `src/lib/navigation.ts` | Edit | Add `/companies/email-settings` ("Platform Email") to `MANAGER_SECTION`. |
| `src/routes/_authenticated/companies.email-settings.tsx` | New Route File | Implement full shadcn UI with loading skeleton, locked sender card, SMTP/IMAP forms, instant handshake tests with latency badges, and save button. |
| `src/lib/platform-email.functions.ts` | New Server Functions | `getPlatformEmailConfig`, `savePlatformEmailConfig`, `testPlatformEmailConnection`, `sendPlatformTestEmail`. Server-side guard `requireSuperAdmin()`. |
| `src/routes/lovable/email/auth/webhook.ts` | Edit | Lock sender address to `Flas CRM <flas@mobidigisol.com>`. |
| `src/lib/onboarding.functions.ts` | Edit | Extend `inviteStaff` to trigger invitation email via `supabaseAdmin.auth.admin.inviteUserByEmail` or direct mailer from `flas@mobidigisol.com`. |
| `src/lib/auth-email-audit.server.ts` | Edit | Support `invite` action in addition to `signup` and `recovery`. |

---

## 7. Verification Method

Implementers can independently verify compliance using:

1. **TypeScript Static Analysis**:
   ```bash
   npx tsc --noEmit
   ```
   Must pass with 0 errors.

2. **Route Generation & Build**:
   ```bash
   npm run build
   ```
   Verify that `routeTree.gen.ts` generates route `/_authenticated/companies/email-settings` and builds cleanly.

3. **Super-Admin Route Access Verification**:
   - Authenticated as `staff_role = 'super_admin'`:
     - Sidebar displays "Platform Email" under Manager section.
     - Navigating to `/companies/email-settings` loads page with loading skeleton then populates form.
     - Changing host/ports and clicking "Test SMTP Connection" returns instant socket latency and status badge.
     - Clicking "Save Configuration" stores credentials encrypted at rest.
   - Authenticated as regular user / `company_admin`:
     - Sidebar hides "Platform Email".
     - Direct URL navigation to `/companies/email-settings` displays manager gate message ("This area is only available to the Flas platform manager") or redirects to `/dashboard`.

4. **Transactional Email Flow Verification**:
   - Trigger password reset on `/auth`: Verify email sender in delivery log is `flas@mobidigisol.com`.
   - Trigger signup OTP on `/auth`: Verify email sender in delivery log is `flas@mobidigisol.com`.
   - Send team invitation from `/settings` (Team card): Verify invite email dispatched from `flas@mobidigisol.com` and recorded in `email_delivery_log`.
