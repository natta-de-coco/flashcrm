import { ConnectionProblemCard } from "@/components/integrations/ConnectionProblemCard";
import { ReadinessBadge } from "@/components/integrations/ReadinessBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { PROVIDER_NAMES, type ProviderReadiness } from "@/lib/connection-problem";
import {
  getProviderReadiness,
  testProviderCredentials,
} from "@/lib/connection-readiness.functions";
import { PROVIDER_SETUP } from "@/lib/provider-setup-links";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Copy, ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

/**
 * Admin-only: the one-time provider configuration, read from the server's own
 * settings rather than from anything a customer types.
 *
 * A normal user never sees this. They press Connect, sign in with the provider
 * and choose which Page or account to connect -- no App ID, no App Secret, no
 * developer console. This screen exists so the platform owner can see, per
 * provider, whether Flas is configured and what is still missing, without any
 * secret value reaching the browser: presence flags, a masked app id and safe
 * timestamps only.
 */
export function ProviderSetupCenter() {
  const { isAdmin, isSuperAdmin } = useAuth();
  const qc = useQueryClient();
  const load = useServerFn(getProviderReadiness);
  const runTest = useServerFn(testProviderCredentials);
  const [copied, setCopied] = useState<string | null>(null);

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const readiness = useQuery({
    queryKey: ["provider-readiness", origin],
    queryFn: () => load({ data: { origin } }),
    enabled: isAdmin,
  });

  const test = useMutation({
    mutationFn: (provider: string) => runTest({ data: { provider, origin } }),
    onSuccess: (result) => {
      const label =
        PROVIDER_NAMES[result.provider as keyof typeof PROVIDER_NAMES] ?? result.provider;
      if (result.status === "passed") {
        toast.success(`${label}: credentials accepted by the provider`);
      } else if (result.status === "failed") {
        toast.error(`${label}: ${result.message}`);
      } else {
        toast.info(`${label}: ${result.message}`);
      }
      void qc.invalidateQueries({ queryKey: ["provider-readiness"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not test the credentials"),
  });

  if (!isAdmin) return null;

  const copy = (value: string, key: string) => {
    void navigator.clipboard.writeText(value);
    setCopied(key);
    toast.success("Copied");
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000);
  };

  return (
    <section id="provider-setup" className="grid gap-4">
      <div>
        <h2 className="text-lg font-semibold">Provider setup</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          One-time setup, done by the Flas administrator. These credentials live in the
          server&apos;s own settings, so the people who connect channels never handle an App ID or
          App Secret: they press Connect, sign in with the provider and choose their Page or
          account.
        </p>
      </div>

      {readiness.isLoading && (
        <div className="grid gap-3 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      )}
      {readiness.error && (
        <p className="text-sm text-destructive">
          {readiness.error instanceof Error
            ? readiness.error.message
            : "Could not load the provider setup"}
        </p>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {(readiness.data ?? []).map((provider) => (
          <ProviderCard
            key={provider.provider}
            provider={provider}
            showTechnical={isSuperAdmin}
            copied={copied}
            onCopy={copy}
            onTest={() => test.mutate(provider.provider)}
            testing={test.isPending && test.variables === provider.provider}
          />
        ))}
      </div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b py-1.5 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium">{children}</span>
    </div>
  );
}

const SOURCE_LABELS: Record<ProviderReadiness["credentialSource"], string> = {
  shared: "Shared Flas app (server settings)",
  workspace: "This workspace's own app",
  none: "Not configured",
};

function ProviderCard({
  provider,
  showTechnical,
  copied,
  onCopy,
  onTest,
  testing,
}: {
  provider: ProviderReadiness;
  showTechnical: boolean;
  copied: string | null;
  onCopy: (value: string, key: string) => void;
  onTest: () => void;
  testing: boolean;
}) {
  const setup = PROVIDER_SETUP[provider.provider];
  const callbackKey = `${provider.provider}-callback`;
  const redirectUri = provider.redirectUri;
  const flag = (ok: boolean, good = "Configured", bad = "Missing") => (
    <span className={ok ? "text-emerald-700" : "text-destructive"}>{ok ? good : bad}</span>
  );

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{provider.name}</CardTitle>
          <div className="flex items-center gap-1.5">
            <Badge variant={provider.configured ? "secondary" : "destructive"}>
              {provider.configured ? "Configured" : "Missing"}
            </Badge>
            <ReadinessBadge state={provider.state} />
          </div>
        </div>
        <CardDescription className="text-xs">{setup?.ownerTask}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <div>
          <Row label="Credential source">{SOURCE_LABELS[provider.credentialSource]}</Row>
          <Row label="App / client ID">
            {provider.appIdPresent ? (
              <code className="rounded bg-muted px-1.5 py-0.5">{provider.appIdMasked}</code>
            ) : (
              flag(false)
            )}
          </Row>
          <Row label="App secret">{flag(provider.secretPresent)}</Row>
          <Row label="Callback URL">
            {redirectUri ? (
              <>
                <code className="max-w-[14rem] truncate rounded bg-muted px-1.5 py-0.5">
                  {redirectUri}
                </code>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 gap-1 px-1.5 text-[11px]"
                  onClick={() => onCopy(redirectUri, callbackKey)}
                >
                  {copied === callbackKey ? (
                    <Check className="size-3" />
                  ) : (
                    <Copy className="size-3" />
                  )}
                  Copy
                </Button>
              </>
            ) : (
              <span className="text-destructive">Set the app address first</span>
            )}
          </Row>
          <Row label="Allowed sign-in origin">{flag(provider.allowedOriginConfigured)}</Row>
          <Row label="Token encryption">{flag(provider.encryptionConfigured, "On", "Off")}</Row>
          <Row label="Provider review">
            {provider.reviewRequired ? "Required for some features" : "Not required"}
          </Row>
          <Row label="Last validation">
            <span
              className={
                provider.lastCredentialTestStatus === "passed"
                  ? "text-emerald-700"
                  : provider.lastCredentialTestStatus === "failed"
                    ? "text-destructive"
                    : "text-muted-foreground"
              }
            >
              {provider.lastCredentialTestStatus === "never"
                ? "Never tested"
                : `${provider.lastCredentialTestStatus === "passed" ? "Passed" : "Failed"}${
                    provider.lastCredentialTest
                      ? ` · ${new Date(provider.lastCredentialTest).toLocaleString()}`
                      : ""
                  }`}
            </span>
          </Row>
        </div>

        {[...provider.blockingIssues, ...provider.warnings].map((problem) => (
          <ConnectionProblemCard
            key={problem.code}
            problem={problem}
            providerName={provider.name}
            showTechnical={showTechnical}
            compact
          />
        ))}

        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2">
          <Button size="sm" variant="outline" className="gap-1" disabled={testing} onClick={onTest}>
            {testing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="size-3.5" />
            )}
            Test configuration
          </Button>
          {(setup?.links ?? []).map((link) => (
            <Button key={link.id} asChild size="sm" variant="ghost" className="h-8 gap-1 text-xs">
              <a href={link.url} target="_blank" rel="noreferrer noopener" title={link.description}>
                {link.label} <ExternalLink className="size-3" />
              </a>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
