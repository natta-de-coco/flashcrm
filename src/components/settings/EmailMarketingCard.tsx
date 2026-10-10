/**
 * src/components/settings/EmailMarketingCard.tsx
 *
 * Tenant BYO Email Marketing Settings Card for Workspace Admins.
 * Allows companies to connect their own SMTP and IMAP servers, configure automated welcome discounts,
 * verify SPF/DKIM DNS records, and test connection latency.
 */

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { friendlyError } from "@/lib/friendly-error";
import {
  getTenantSmtpConfig,
  saveTenantSmtpConfig,
  testTenantSmtpConnection,
  verifyTenantDnsRecords,
} from "@/lib/tenant-smtp.functions";
import type { DnsVerificationReport, TenantSmtpConfigInput } from "@/types/tenant-email";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Key,
  Loader2,
  Mail,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export function EmailMarketingCard() {
  const qc = useQueryClient();
  const getConfigFn = useServerFn(getTenantSmtpConfig);
  const saveConfigFn = useServerFn(saveTenantSmtpConfig);
  const testConnectionFn = useServerFn(testTenantSmtpConnection);
  const verifyDnsFn = useServerFn(verifyTenantDnsRecords);

  const [activeTab, setActiveTab] = useState<"smtp" | "imap" | "welcome" | "dns">("smtp");
  const [form, setForm] = useState<TenantSmtpConfigInput>({
    fromEmail: "",
    fromName: "",
    replyTo: "",
    smtpHost: "",
    smtpPort: 465,
    smtpSecure: true,
    smtpUser: "",
    smtpPassword: "",
    imapHost: "",
    imapPort: 993,
    imapSecure: true,
    imapUser: "",
    imapPassword: "",
    imapEnabled: false,
    welcomeEmailEnabled: true,
    welcomeDiscountCode: "WELCOME20",
    welcomeDiscountPercent: 20,
    welcomeSubject: "Welcome to Flas CRM — Here is your discount code!",
    welcomeBodyHtml: "",
  });

  const [dnsDomain, setDnsDomain] = useState("");
  const [dnsReport, setDnsReport] = useState<DnsVerificationReport | null>(null);

  const configQuery = useQuery({
    queryKey: ["tenant-smtp-config"],
    queryFn: async () => {
      const data = await getConfigFn();
      return data;
    },
  });

  useEffect(() => {
    if (configQuery.data) {
      const d = configQuery.data;
      setForm({
        fromEmail: d.fromEmail,
        fromName: d.fromName,
        replyTo: d.replyTo,
        smtpHost: d.smtpHost,
        smtpPort: d.smtpPort,
        smtpSecure: d.smtpSecure,
        smtpUser: d.smtpUser,
        smtpPassword: "", // Never populate plaintext
        imapHost: d.imapHost,
        imapPort: d.imapPort,
        imapSecure: d.imapSecure,
        imapUser: d.imapUser,
        imapPassword: "",
        imapEnabled: d.imapEnabled,
        welcomeEmailEnabled: d.welcomeEmailEnabled,
        welcomeDiscountCode: d.welcomeDiscountCode,
        welcomeDiscountPercent: d.welcomeDiscountPercent,
        welcomeSubject: d.welcomeSubject,
        welcomeBodyHtml: d.welcomeBodyHtml,
      });

      if (d.fromEmail.includes("@")) {
        setDnsDomain(d.fromEmail.split("@")[1] || "");
      }
    }
  }, [configQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      return await saveConfigFn({ data: form });
    },
    onSuccess: () => {
      toast.success("Email marketing settings saved. Remember to test connection to verify.");
      void qc.invalidateQueries({ queryKey: ["tenant-smtp-config"] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const testSmtpMutation = useMutation({
    mutationFn: async () => {
      return await testConnectionFn({ data: { type: "smtp" } });
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success(`SMTP connected successfully in ${res.latencyMs}ms!`);
      } else {
        toast.error(`SMTP connection failed: ${res.message}`);
      }
      void qc.invalidateQueries({ queryKey: ["tenant-smtp-config"] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const testImapMutation = useMutation({
    mutationFn: async () => {
      return await testConnectionFn({ data: { type: "imap" } });
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success(`IMAP connected successfully in ${res.latencyMs}ms!`);
      } else {
        toast.error(`IMAP connection failed: ${res.message}`);
      }
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const checkDnsMutation = useMutation({
    mutationFn: async () => {
      const domain = dnsDomain.trim() || form.fromEmail?.split("@")[1] || "example.com";
      return await verifyDnsFn({ data: { domain } });
    },
    onSuccess: (report) => {
      setDnsReport(report);
      toast.success("DNS records checked successfully");
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  function copyText(val: string) {
    void navigator.clipboard.writeText(val);
    toast.success("Copied to clipboard");
  }

  if (configQuery.isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-4 w-2/3" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  const isVerified = Boolean(configQuery.data?.verified);

  return (
    <Card className="border-border">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg">Email Marketing & Custom SMTP</CardTitle>
              {isVerified ? (
                <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-700">
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  Verified
                </Badge>
              ) : (
                <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  <AlertCircle className="mr-1 h-3 w-3" />
                  Unverified
                </Badge>
              )}
            </div>
            <CardDescription>
              Connect your company&apos;s own SMTP server to send marketing campaigns and automated welcome discounts.
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => testSmtpMutation.mutate()}
              disabled={testSmtpMutation.isPending || !form.smtpHost}
            >
              {testSmtpMutation.isPending ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-3.5 w-3.5" />
              )}
              Test SMTP
            </Button>
            <Button
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Save Configuration
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {!isVerified && (
          <div className="mb-4 rounded-lg border border-amber-300/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
            <strong>Action required:</strong> You must configure and test your custom SMTP server before campaigns can be scheduled or dispatched.
          </div>
        )}

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
          <TabsList className="grid grid-cols-4 mb-4">
            <TabsTrigger value="smtp">Outbound SMTP</TabsTrigger>
            <TabsTrigger value="imap">Inbound IMAP</TabsTrigger>
            <TabsTrigger value="welcome">Welcome Automation</TabsTrigger>
            <TabsTrigger value="dns">Domain DNS Guide</TabsTrigger>
          </TabsList>

          {/* TAB 1: OUTBOUND SMTP */}
          <TabsContent value="smtp" className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="fromName">Sender Name</Label>
                <Input
                  id="fromName"
                  placeholder="e.g. Acme Sales"
                  value={form.fromName || ""}
                  onChange={(e) => setForm({ ...form, fromName: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="fromEmail">From Email Address</Label>
                <Input
                  id="fromEmail"
                  type="email"
                  placeholder="newsletter@yourcompany.com"
                  value={form.fromEmail || ""}
                  onChange={(e) => setForm({ ...form, fromEmail: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="replyTo">Reply-To Address (Optional)</Label>
                <Input
                  id="replyTo"
                  type="email"
                  placeholder="support@yourcompany.com"
                  value={form.replyTo || ""}
                  onChange={(e) => setForm({ ...form, replyTo: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="smtpHost">SMTP Host Server</Label>
                <Input
                  id="smtpHost"
                  placeholder="smtp.mailgun.org / mail.yourdomain.com"
                  value={form.smtpHost || ""}
                  onChange={(e) => setForm({ ...form, smtpHost: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="smtpPort">SMTP Port</Label>
                <Input
                  id="smtpPort"
                  type="number"
                  placeholder="465 or 587"
                  value={form.smtpPort || 465}
                  onChange={(e) => setForm({ ...form, smtpPort: Number(e.target.value) || 465 })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="smtpUser">SMTP Username</Label>
                <Input
                  id="smtpUser"
                  placeholder="smtp_username / api_key"
                  value={form.smtpUser || ""}
                  onChange={(e) => setForm({ ...form, smtpUser: e.target.value })}
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="smtpPassword">
                  SMTP Password
                  {configQuery.data?.hasSmtpPassword && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      (Configured: •••••••• — leave blank to keep unchanged)
                    </span>
                  )}
                </Label>
                <Input
                  id="smtpPassword"
                  type="password"
                  placeholder="Enter new password or leave blank"
                  value={form.smtpPassword || ""}
                  onChange={(e) => setForm({ ...form, smtpPassword: e.target.value })}
                />
              </div>

              <div className="flex items-center space-x-2 sm:col-span-2">
                <Switch
                  id="smtpSecure"
                  checked={form.smtpSecure !== false}
                  onCheckedChange={(checked) => setForm({ ...form, smtpSecure: checked })}
                />
                <Label htmlFor="smtpSecure">Use SSL/TLS (Port 465). Turn off for STARTTLS (Port 587).</Label>
              </div>
            </div>
          </TabsContent>

          {/* TAB 2: INBOUND IMAP */}
          <TabsContent value="imap" className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="imapEnabled" className="text-base font-medium">Inbound Email Reply Sync</Label>
                <p className="text-xs text-muted-foreground">
                  Ingest customer replies directly into Flas CRM shared inbox alongside WhatsApp messages.
                </p>
              </div>
              <Switch
                id="imapEnabled"
                checked={form.imapEnabled === true}
                onCheckedChange={(checked) => setForm({ ...form, imapEnabled: checked })}
              />
            </div>

            {form.imapEnabled && (
              <div className="grid gap-4 sm:grid-cols-2 pt-2">
                <div className="space-y-1.5">
                  <Label htmlFor="imapHost">IMAP Host Server</Label>
                  <Input
                    id="imapHost"
                    placeholder="imap.yourdomain.com"
                    value={form.imapHost || ""}
                    onChange={(e) => setForm({ ...form, imapHost: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="imapPort">IMAP Port</Label>
                  <Input
                    id="imapPort"
                    type="number"
                    placeholder="993"
                    value={form.imapPort || 993}
                    onChange={(e) => setForm({ ...form, imapPort: Number(e.target.value) || 993 })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="imapUser">IMAP Username</Label>
                  <Input
                    id="imapUser"
                    placeholder="inbox@yourdomain.com"
                    value={form.imapUser || ""}
                    onChange={(e) => setForm({ ...form, imapUser: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="imapPassword">
                    IMAP Password
                    {configQuery.data?.hasImapPassword && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        (Configured: ••••••••)
                      </span>
                    )}
                  </Label>
                  <Input
                    id="imapPassword"
                    type="password"
                    placeholder="Enter IMAP password"
                    value={form.imapPassword || ""}
                    onChange={(e) => setForm({ ...form, imapPassword: e.target.value })}
                  />
                </div>

                <div className="sm:col-span-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => testImapMutation.mutate()}
                    disabled={testImapMutation.isPending || !form.imapHost}
                  >
                    {testImapMutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                    Test IMAP Handshake
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          {/* TAB 3: WELCOME AUTOMATION */}
          <TabsContent value="welcome" className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="welcomeEmailEnabled" className="text-base font-medium">Automated Welcome Offer</Label>
                <p className="text-xs text-muted-foreground">
                  Instantly dispatch an email with your promotional discount when a visitor subscribes with consent.
                </p>
              </div>
              <Switch
                id="welcomeEmailEnabled"
                checked={form.welcomeEmailEnabled !== false}
                onCheckedChange={(checked) => setForm({ ...form, welcomeEmailEnabled: checked })}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="welcomeDiscountCode">Promo Discount Code</Label>
                <Input
                  id="welcomeDiscountCode"
                  placeholder="e.g. WELCOME20 or SPECIAL10"
                  value={form.welcomeDiscountCode || "WELCOME20"}
                  onChange={(e) => setForm({ ...form, welcomeDiscountCode: e.target.value.toUpperCase() })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="welcomeDiscountPercent">Discount Value (%)</Label>
                <Input
                  id="welcomeDiscountPercent"
                  type="number"
                  placeholder="20"
                  value={form.welcomeDiscountPercent || 20}
                  onChange={(e) => setForm({ ...form, welcomeDiscountPercent: Number(e.target.value) || 20 })}
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="welcomeSubject">Email Subject Line</Label>
                <Input
                  id="welcomeSubject"
                  placeholder="Welcome! Here is your exclusive discount"
                  value={form.welcomeSubject || ""}
                  onChange={(e) => setForm({ ...form, welcomeSubject: e.target.value })}
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="welcomeBodyHtml">Custom Welcome Message / Note</Label>
                <Textarea
                  id="welcomeBodyHtml"
                  rows={3}
                  placeholder="Thank you for subscribing! We are thrilled to welcome you. Use the code above for your first purchase."
                  value={form.welcomeBodyHtml || ""}
                  onChange={(e) => setForm({ ...form, welcomeBodyHtml: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Merge tags supported: {"{{name}}"}, {"{{company}}"}, {"{{discount_code}}"}, {"{{unsubscribe_url}}"}.
                </p>
              </div>
            </div>
          </TabsContent>

          {/* TAB 4: DOMAIN DNS GUIDE */}
          <TabsContent value="dns" className="space-y-4">
            <div className="flex items-center gap-2">
              <Input
                placeholder="yourcompany.com"
                value={dnsDomain}
                onChange={(e) => setDnsDomain(e.target.value)}
                className="max-w-xs"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => checkDnsMutation.mutate()}
                disabled={checkDnsMutation.isPending || !dnsDomain}
              >
                {checkDnsMutation.isPending ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                )}
                Verify DNS Records
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              To maximize inbox deliverability and prevent emails from landing in spam, add these DNS TXT records to your domain provider (e.g. Cloudflare, GoDaddy, Namecheap):
            </p>

            <div className="space-y-3">
              {/* SPF Record */}
              <div className="rounded-lg border p-3 bg-muted/30">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold">1. SPF (Sender Policy Framework)</span>
                  <Badge variant={dnsReport?.spf.status === "verified" ? "default" : "secondary"}>
                    {dnsReport?.spf.status === "verified" ? "Valid" : "Pending Check"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between rounded bg-background p-2 font-mono text-xs border">
                  <span>v=spf1 include:_spf.flas.app ~all</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyText("v=spf1 include:_spf.flas.app ~all")}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              {/* DKIM Record */}
              <div className="rounded-lg border p-3 bg-muted/30">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold">2. DKIM (DomainKeys Identified Mail)</span>
                  <Badge variant={dnsReport?.dkim.status === "verified" ? "default" : "secondary"}>
                    {dnsReport?.dkim.status === "verified" ? "Valid" : "Pending Check"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between rounded bg-background p-2 font-mono text-xs border">
                  <span>Host: flas._domainkey | Type: TXT</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyText("flas._domainkey")}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              {/* DMARC Record */}
              <div className="rounded-lg border p-3 bg-muted/30">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold">3. DMARC (Email Authentication Policy)</span>
                  <Badge variant={dnsReport?.dmarc.status === "verified" ? "default" : "secondary"}>
                    {dnsReport?.dmarc.status === "verified" ? "Valid" : "Recommended"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between rounded bg-background p-2 font-mono text-xs border">
                  <span>Host: _dmarc | Value: v=DMARC1; p=none;</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyText("v=DMARC1; p=none;")}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
