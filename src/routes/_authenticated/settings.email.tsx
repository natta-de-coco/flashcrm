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
import { useI18n } from "@/hooks/useI18n";

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
  const { t, tr } = useI18n();
  const load = useServerFn(getTenantSmtpConfig);
  const save = useServerFn(saveTenantSmtpConfig);
  const setKey = useServerFn(setTenantSmtpApiKey);
  const test = useServerFn(testTenantSmtp);

  const [config, setConfig] = useState<Config | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState(false);

  // A failure here used to leave `config` null forever, so the page sat on
  // "Loading email settings…" with no error, no toast and no way to retry.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setLoadError(null);
        const c = await load({ data: undefined });
        if (!cancelled) setConfig(c as Config);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Could not load settings.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, reloadKey]);

  if (loadError) {
    return (
      <main className="grid gap-3 p-6">
        <p className="text-sm font-medium">{t("settingsEmail.emailSettingsCouldNotBe")}</p>
        <p className="text-sm text-muted-foreground">{loadError}</p>
        <div>
          <Button size="sm" variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
            {t("settingsEmail.tryAgain")}
          </Button>
        </div>
      </main>
    );
  }

  if (!config) {
    return (
      <main className="p-6 text-sm text-muted-foreground">
        {t("settingsEmail.loadingEmailSettings")}
      </main>
    );
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
      toast.success(t("settingsEmail.settingsSavedRotateYourApi"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("settingsEmail.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function onSetKey() {
    if (!apiKey.trim()) {
      toast.error(t("settingsEmail.pasteYourProviderApiKey"));
      return;
    }
    setBusy(true);
    try {
      await setKey({ data: { apiKey: apiKey.trim() } });
      setApiKey("");
      toast.success(t("settingsEmail.apiKeyStoredAndEncrypted"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("settingsEmail.couldNotStoreKey"));
    } finally {
      setBusy(false);
    }
  }

  async function onTest() {
    if (!testTo.trim()) {
      toast.error(t("settingsEmail.enterAnEmailAddressTo"));
      return;
    }
    setBusy(true);
    try {
      const res = (await test({ data: { toEmail: testTo.trim() } })) as {
        ok: boolean;
        error?: string;
      };
      if (res.ok)
        toast.success(t("settingsEmail.testEmailSentVia", { provider: config!.provider }));
      else toast.error(res.error ?? t("settingsEmail.testFailed"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("settingsEmail.testFailed"));
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
        <h1 className="text-[1.75rem] font-bold leading-tight sm:text-3xl">
          {t("settingsEmail.emailDelivery")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settingsEmail.pickAProviderForYour")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("settingsEmail.provider")}</CardTitle>
          <CardDescription>
            {tr("settingsEmail.freeCheapPicks3kEmails", {
              strong: <strong>Resend</strong>,
              strong2: <strong>Postmark</strong>,
              strong3: <strong>Mailgun</strong>,
              em: <em>{t("settingsEmail.platform")}</em>,
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>{t("settingsEmail.provider")}</Label>
            <Select
              value={config.provider}
              onValueChange={(v) => setConfig({ ...config, provider: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="platform">
                  {t("settingsEmail.platformDefaultNoApiKey")}
                </SelectItem>
                <SelectItem value="resend">
                  {t("settingsEmail.resendRecommendedSimplest")}
                </SelectItem>
                <SelectItem value="postmark">Postmark</SelectItem>
                <SelectItem value="mailgun">Mailgun</SelectItem>
                <SelectItem value="sendgrid">SendGrid</SelectItem>
                <SelectItem value="ses">AWS SES (HTTPS)</SelectItem>
                <SelectItem value="smtp_relay">
                  {t("settingsEmail.smtpRelayHttpsGateway")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("settingsEmail.fromEmail")}</Label>
              <Input
                type="email"
                value={config.from_email ?? ""}
                onChange={(e) => setConfig({ ...config, from_email: e.target.value })}
                placeholder="no-reply@yourdomain.com"
              />
            </div>
            <div className="space-y-2">
              <Label>{t("settingsEmail.fromName")}</Label>
              <Input
                value={config.from_name ?? ""}
                onChange={(e) => setConfig({ ...config, from_name: e.target.value })}
                placeholder={t("settingsEmail.acmeTrading")}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("settingsEmail.replyToOptional")}</Label>
              <Input
                type="email"
                value={config.reply_to ?? ""}
                onChange={(e) => setConfig({ ...config, reply_to: e.target.value })}
                placeholder="support@yourdomain.com"
              />
            </div>
            {needsDomain && (
              <div className="space-y-2">
                <Label>{t("settingsEmail.sendingDomainMailgun")}</Label>
                <Input
                  value={config.domain ?? ""}
                  onChange={(e) => setConfig({ ...config, domain: e.target.value })}
                  placeholder="mg.yourdomain.com"
                />
              </div>
            )}
            {needsRegion && (
              <div className="space-y-2">
                <Label>{t("settingsEmail.region")}</Label>
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
              {t("settingsEmail.saveSettings")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {needsKey && (
        <Card>
          <CardHeader>
            <CardTitle>{t("settingsEmail.apiKey")}</CardTitle>
            <CardDescription>{t("settingsEmail.encryptedAtRestWithPgcrypto")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{t("settingsEmail.providerApiKey")}</Label>
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={t("settingsEmail.pasteYourApiKey")}
                autoComplete="new-password"
              />
            </div>
            <Button onClick={onSetKey} disabled={busy || !apiKey}>
              {t("settingsEmail.saveApiKey")}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("settingsEmail.sendTestEmail")}</CardTitle>
          <CardDescription>{t("settingsEmail.verifiesTheProviderKeyFrom")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>{t("settingsEmail.sendTestTo")}</Label>
            <Input
              type="email"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="you@yourdomain.com"
            />
          </div>
          <Button onClick={onTest} disabled={busy}>
            {t("settingsEmail.sendTest")}
          </Button>
          {config.last_test_at && (
            <p
              className={`text-xs ${config.last_test_ok ? "text-emerald-600" : "text-destructive"}`}
            >
              {tr("settingsEmail.lastTest", {
                toLocaleString: new Date(config.last_test_at).toLocaleString(),
                value: config.last_test_ok
                  ? "OK"
                  : (config.last_test_error ?? t("settingsEmail.failed")),
              })}
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
