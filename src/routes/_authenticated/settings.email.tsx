import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getTenantSmtpConfig,
  saveTenantSmtpConfig,
  setTenantSmtpApiKey,
  testTenantSmtp,
} from "@/lib/tenant-smtp.functions";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * Company admin: pick your outbound-email provider and paste an API key.
 * The api_key is encrypted at rest in Postgres (pgcrypto) and never round-
 * trips back through the API — so the UI treats it as write-only.
 */
export const Route = createFileRoute("/_authenticated/settings/email")({
  head: () => ({
    meta: [
      { title: "Email settings — Flas CRM" },
      {
        name: "description",
        content:
          "Configure how your company sends transactional email (verify / reset / notifications).",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EmailSettingsPage,
});

type Config = {
  provider: string;
  from_email: string | null;
  from_name: string | null;
  reply_to: string | null;
  region: string | null;
  domain: string | null;
  verified: boolean;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_error: string | null;
};

function EmailSettingsPage() {
  const load = useServerFn(getTenantSmtpConfig);
  const save = useServerFn(saveTenantSmtpConfig);
  const setKey = useServerFn(setTenantSmtpApiKey);
  const test = useServerFn(testTenantSmtp);

  const [config, setConfig] = useState<Config | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const c = await load({ data: undefined });
      setConfig(c as Config);
    })();
  }, [load]);

  if (!config) {
    return <main className="p-6 text-sm text-muted-foreground">Loading email settings…</main>;
  }

  async function onSave() {
    setBusy(true);
    try {
      await save({
        data: {
          provider: config!.provider as
            "platform" | "resend" | "mailgun" | "sendgrid" | "postmark" | "ses" | "smtp_relay",
          fromEmail: config!.from_email,
          fromName: config!.from_name,
          replyTo: config!.reply_to,
          region: config!.region,
          domain: config!.domain,
        },
      });
      toast.success("Settings saved. Rotate your API key if the provider changed.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function onSetKey() {
    if (!apiKey.trim()) {
      toast.error("Paste your provider API key first.");
      return;
    }
    setBusy(true);
    try {
      await setKey({ data: { apiKey: apiKey.trim() } });
      setApiKey("");
      toast.success("API key stored and encrypted. Send a test to verify it.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not store key");
    } finally {
      setBusy(false);
    }
  }

  async function onTest() {
    if (!testTo.trim()) {
      toast.error("Enter an email address to send the test to.");
      return;
    }
    setBusy(true);
    try {
      const res = (await test({ data: { toEmail: testTo.trim() } })) as {
        ok: boolean;
        error?: string;
      };
      if (res.ok) toast.success(`Test email sent via ${config!.provider}.`);
      else toast.error(res.error ?? "Test failed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    } finally {
      setBusy(false);
    }
  }

  const needsKey = config.provider !== "platform";
  const needsDomain = config.provider === "mailgun";
  const needsRegion = config.provider === "mailgun" || config.provider === "ses";

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Email delivery</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick a provider for your company's outbound email — verification codes, password resets,
          invoice notifications, invite messages, etc. Raw SMTP is not supported (serverless
          platforms block outbound TCP on ports 465/587). Any HTTP-based transactional provider
          works.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Provider</CardTitle>
          <CardDescription>
            Free / cheap picks: <strong>Resend</strong> (3k emails/mo free),{" "}
            <strong>Postmark</strong> (100/mo free), <strong>Mailgun</strong>. Choose{" "}
            <em>Platform</em> to keep using the built-in mailer.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Provider</Label>
            <Select
              value={config.provider}
              onValueChange={(v) => setConfig({ ...config, provider: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="platform">Platform default (no API key needed)</SelectItem>
                <SelectItem value="resend">Resend (recommended — simplest)</SelectItem>
                <SelectItem value="postmark">Postmark</SelectItem>
                <SelectItem value="mailgun">Mailgun</SelectItem>
                <SelectItem value="sendgrid">SendGrid</SelectItem>
                <SelectItem value="ses">AWS SES (HTTPS)</SelectItem>
                <SelectItem value="smtp_relay">SMTP relay (HTTPS gateway)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>From email</Label>
              <Input
                type="email"
                value={config.from_email ?? ""}
                onChange={(e) => setConfig({ ...config, from_email: e.target.value })}
                placeholder="no-reply@yourdomain.com"
              />
            </div>
            <div className="space-y-2">
              <Label>From name</Label>
              <Input
                value={config.from_name ?? ""}
                onChange={(e) => setConfig({ ...config, from_name: e.target.value })}
                placeholder="Acme Trading"
              />
            </div>
            <div className="space-y-2">
              <Label>Reply-to (optional)</Label>
              <Input
                type="email"
                value={config.reply_to ?? ""}
                onChange={(e) => setConfig({ ...config, reply_to: e.target.value })}
                placeholder="support@yourdomain.com"
              />
            </div>
            {needsDomain && (
              <div className="space-y-2">
                <Label>Sending domain (Mailgun)</Label>
                <Input
                  value={config.domain ?? ""}
                  onChange={(e) => setConfig({ ...config, domain: e.target.value })}
                  placeholder="mg.yourdomain.com"
                />
              </div>
            )}
            {needsRegion && (
              <div className="space-y-2">
                <Label>Region</Label>
                <Select
                  value={config.region ?? "us"}
                  onValueChange={(v) => setConfig({ ...config, region: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="us">US</SelectItem>
                    <SelectItem value="eu">EU</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button onClick={onSave} disabled={busy}>
              Save settings
            </Button>
          </div>
        </CardContent>
      </Card>

      {needsKey && (
        <Card>
          <CardHeader>
            <CardTitle>API key</CardTitle>
            <CardDescription>
              Encrypted at rest with pgcrypto. Never displayed back — paste again to rotate.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Provider API key</Label>
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Paste your API key"
                autoComplete="new-password"
              />
            </div>
            <Button onClick={onSetKey} disabled={busy || !apiKey}>
              Save API key
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Send test email</CardTitle>
          <CardDescription>
            Verifies the provider + key + from-address by sending a test. Result logged to your
            email delivery log.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Send test to</Label>
            <Input
              type="email"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="you@yourdomain.com"
            />
          </div>
          <Button onClick={onTest} disabled={busy}>
            Send test
          </Button>
          {config.last_test_at && (
            <p
              className={`text-xs ${config.last_test_ok ? "text-emerald-600" : "text-destructive"}`}
            >
              Last test {new Date(config.last_test_at).toLocaleString()}:{" "}
              {config.last_test_ok ? "OK" : (config.last_test_error ?? "Failed")}
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
