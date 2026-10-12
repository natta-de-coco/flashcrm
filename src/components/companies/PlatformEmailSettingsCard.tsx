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
  type PlatformEmailConfigPublic,
} from "@/lib/platform-email.functions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Inbox,
  Info,
  Loader2,
  Lock,
  RefreshCw,
  Send,
  Server,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export function PlatformEmailSettingsSkeleton() {
  return (
    <div className="space-y-6">
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

export function PlatformEmailSettingsCard() {
  const { isSuperAdmin, loading: authLoading } = useAuth();
  const qc = useQueryClient();

  const fetchConfig = useServerFn(getPlatformEmailConfig);
  const saveConfig = useServerFn(savePlatformEmailConfig);
  const testConn = useServerFn(testPlatformEmailConnection);
  const sendTest = useServerFn(sendPlatformTestEmail);

  // Form state
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

  // Test diagnostic feedback
  type TestDiagnosticResult = {
    ok: boolean;
    latencyMs?: number | undefined;
    error?: string | undefined;
    steps?: string[] | undefined;
    stepsCompleted?: string[] | undefined;
    status?: string | undefined;
    message?: string | undefined;
    smtpResult?: unknown;
    imapResult?: unknown;
  };

  const [smtpTestResult, setSmtpTestResult] = useState<TestDiagnosticResult | null>(null);
  const [imapTestResult, setImapTestResult] = useState<TestDiagnosticResult | null>(null);

  const [liveTestRecipient, setLiveTestRecipient] = useState("");

  const configQuery = useQuery({
    queryKey: ["platform-email-config"],
    queryFn: () => fetchConfig(),
    enabled: isSuperAdmin,
  });

  // Hydrate form on load
  useEffect(() => {
    if (configQuery.data) {
      const d = configQuery.data as PlatformEmailConfigPublic;
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
          imapHost: imapHost || null,
          imapPort: Number(imapPort),
          imapSecure,
          imapUser: imapUser || null,
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
        toast.error(`SMTP handshake failed: ${res.error ?? res.message}`);
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
        toast.error(`IMAP handshake failed: ${res.error ?? res.message}`);
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
        toast.error(`Dispatch failed: ${res.message}`);
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Test email failed"),
  });

  if (!authLoading && !isSuperAdmin) {
    return (
      <Card className="border-destructive/30 bg-destructive/5 p-6 text-center">
        <p className="text-sm font-medium text-destructive">
          This area is only available to the Flas platform manager.
        </p>
      </Card>
    );
  }

  const d = configQuery.data as PlatformEmailConfigPublic | undefined;

  return (
    <div className="space-y-6">
      {/* Status Summary Banner if exists */}
      {d && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Connection Status:
            </span>
            {d.verified && d.lastTestOk ? (
              <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 gap-1 border-emerald-500/20">
                <CheckCircle2 className="size-3" /> Connected &amp; Verified
                {d.lastTestLatencyMs ? ` (${d.lastTestLatencyMs}ms)` : ""}
              </Badge>
            ) : d.lastTestError ? (
              <Badge variant="destructive" className="gap-1">
                <AlertCircle className="size-3" /> Connection Failed
              </Badge>
            ) : (
              <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 gap-1">
                <Clock className="size-3" /> Not Verified
              </Badge>
            )}
          </div>
          {d.lastTestAt && (
            <span className="text-xs text-muted-foreground">
              Last tested: {new Date(d.lastTestAt).toLocaleString()}
            </span>
          )}
        </div>
      )}

      {configQuery.isLoading ? (
        <PlatformEmailSettingsSkeleton />
      ) : (
        <>
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
                    Dedicated identity used exclusively for platform transactional emails.
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

          {/* Cards 2 & 3: SMTP & IMAP Configuration Grid */}
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
                  Last tested: {new Date(d.lastTestAt).toLocaleString()}
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
                  if (imapHost) testImapMutation.mutate();
                }}
                disabled={testSmtpMutation.isPending || testImapMutation.isPending}
              >
                Test Connections
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
        </>
      )}
    </div>
  );
}
