import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listPlatformApps, savePlatformApp } from "@/lib/platform-apps.functions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Copy, ExternalLink, KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/hooks/useI18n";

export type ProviderKey = "meta" | "google" | "linkedin" | "tiktok" | "twitter" | "pinterest";

export type ProviderReady = Record<
  string,
  { ready: boolean; source?: "workspace" | "shared" | "none"; envNames: string[] }
>;

export const PROVIDER_INFO: Record<
  ProviderKey,
  { name: string; covers: string; consoleUrl: string; idLabel: string; secretLabel: string }
> = {
  meta: {
    name: "Meta (Facebook, Instagram, Threads, Meta Ads)",
    covers: "Facebook Pages, Instagram, Threads, Meta Ads",
    consoleUrl: "https://developers.facebook.com/apps",
    idLabel: "App ID",
    secretLabel: "App Secret",
  },
  google: {
    name: "Google (YouTube, Business Profile, Ads, Analytics, Search Console)",
    covers: "YouTube, Google Business Profile, Google Ads, Analytics, Search Console",
    consoleUrl: "https://console.cloud.google.com/apis/credentials",
    idLabel: "OAuth Client ID",
    secretLabel: "Client Secret",
  },
  linkedin: {
    name: "LinkedIn",
    covers: "LinkedIn Pages and LinkedIn Ads",
    consoleUrl: "https://www.linkedin.com/developers/apps",
    idLabel: "Client ID",
    secretLabel: "Client Secret",
  },
  tiktok: {
    name: "TikTok",
    covers: "TikTok profile and TikTok Ads",
    consoleUrl: "https://developers.tiktok.com/apps",
    idLabel: "Client Key",
    secretLabel: "Client Secret",
  },
  twitter: {
    name: "X (Twitter)",
    covers: "X posting and analytics",
    consoleUrl: "https://developer.x.com/en/portal/dashboard",
    idLabel: "Client ID",
    secretLabel: "Client Secret",
  },
  pinterest: {
    name: "Pinterest",
    covers: "Pinterest boards and pins",
    consoleUrl: "https://developers.pinterest.com/apps",
    idLabel: "App ID",
    secretLabel: "App Secret",
  },
};

export function redirectUri() {
  return typeof window === "undefined"
    ? "/api/public/oauth-callback"
    : `${window.location.origin}/api/public/oauth-callback`;
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex min-w-0 items-center gap-1.5">
        <Input readOnly value={value} className="h-8 min-w-0 text-xs" />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-8 shrink-0 gap-1 text-xs"
          onClick={() => {
            void navigator.clipboard.writeText(value);
            toast.success(t("platformAppsCard.copied", { label: label }));
          }}
        >
          <Copy className="size-3" /> {t("platformAppsCard.copy")}
        </Button>
      </div>
    </div>
  );
}

/** Dialog where a workspace pastes its own platform app keys, once per family. */
export function PlatformAppKeysDialog({
  provider,
  open,
  onOpenChange,
}: {
  provider: ProviderKey | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t, tr } = useI18n();
  const qc = useQueryClient();
  const save = useServerFn(savePlatformApp);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  useEffect(() => {
    if (open) {
      setClientId("");
      setClientSecret("");
    }
  }, [open, provider]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!provider) throw new Error("Pick a platform first.");
      return save({
        data: { provider, clientId: clientId.trim(), clientSecret: clientSecret.trim() },
      });
    },
    onSuccess: () => {
      toast.success(t("platformAppsCard.appKeysSavedThisPlatform"));
      void qc.invalidateQueries({ queryKey: ["connections"] });
      void qc.invalidateQueries({ queryKey: ["platform-apps"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const info = provider ? PROVIDER_INFO[provider] : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">
            {info
              ? t("platformAppsCard.connectYourApp", { name: info.name })
              : t("platformAppsCard.platformAppKeys")}
          </DialogTitle>
          <DialogDescription>{t("platformAppsCard.flasUsesYourOwnDeveloper")}</DialogDescription>
        </DialogHeader>

        {info ? (
          <div className="grid gap-3">
            <ol className="grid gap-1 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
              <li>{t("platformAppsCard.1OpenTheDeveloperConsole")}</li>
              <li>{t("platformAppsCard.2AddTheRedirectUrl")}</li>
              <li>
                {tr("platformAppsCard.3CopyTheAndInto", {
                  idLabel: info.idLabel,
                  secretLabel: info.secretLabel,
                })}
              </li>
              <li>{tr("platformAppsCard.4SaveThenPressConnect", { covers: info.covers })}</li>
            </ol>
            <CopyRow label={t("platformAppsCard.redirectUrl")} value={redirectUri()} />
            <Button asChild size="sm" variant="outline" className="w-fit gap-1 text-xs">
              <a href={info.consoleUrl} target="_blank" rel="noreferrer noopener">
                {t("platformAppsCard.openDeveloperConsole")} <ExternalLink className="size-3" />
              </a>
            </Button>
            <div className="grid gap-2">
              <Label htmlFor="app-id">{info.idLabel}</Label>
              <Input
                id="app-id"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="app-secret">{info.secretLabel}</Label>
              <Input
                id="app-secret"
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                autoComplete="new-password"
              />
              <p className="text-[11px] text-muted-foreground">
                {t("platformAppsCard.storedEncryptedAgainstYourWorkspace")}
              </p>
            </div>
            <Button
              disabled={
                mutation.isPending || clientId.trim().length < 4 || clientSecret.trim().length < 8
              }
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending
                ? t("platformAppsCard.saving")
                : t("platformAppsCard.saveAppKeys")}
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Overview of every OAuth provider family and whether it can be authorized. */
export function PlatformAppsCard({ providerReady }: { providerReady?: ProviderReady }) {
  const { t } = useI18n();
  const apps = useQuery({ queryKey: ["platform-apps"], queryFn: () => listPlatformApps() });
  const [provider, setProvider] = useState<ProviderKey | null>(null);
  const configured = new Set((apps.data ?? []).map((a) => a.provider));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="size-4 text-primary" /> {t("platformAppsCard.platformAppKeys")}
        </CardTitle>
        <CardDescription>{t("platformAppsCard.eachPlatformRequiresItsOwn")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        <CopyRow label={t("platformAppsCard.redirectUrlForEveryPlatform")} value={redirectUri()} />
        <div className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(PROVIDER_INFO) as ProviderKey[]).map((key) => {
            const ready = providerReady?.[key]?.ready ?? configured.has(key);
            const source = providerReady?.[key]?.source;
            return (
              <div
                key={key}
                className="flex min-w-0 items-start justify-between gap-2 rounded-md border p-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{PROVIDER_INFO[key].name}</p>
                  <p className="text-[11px] text-muted-foreground">{PROVIDER_INFO[key].covers}</p>
                  <Badge
                    variant={ready ? "default" : "outline"}
                    className="mt-1.5 gap-1 px-1.5 py-0 text-[10px]"
                  >
                    {ready ? <CheckCircle2 className="size-3" /> : null}
                    {ready
                      ? source === "shared"
                        ? t("platformAppsCard.readyFlasSharedApp")
                        : t("platformAppsCard.readyYourApp")
                      : t("platformAppsCard.keysNeeded")}
                  </Badge>
                </div>
                <Button
                  size="sm"
                  variant={ready ? "outline" : "default"}
                  className="h-7 shrink-0 px-2 text-xs"
                  onClick={() => setProvider(key)}
                >
                  {configured.has(key)
                    ? t("platformAppsCard.replace")
                    : t("platformAppsCard.addKeys")}
                </Button>
              </div>
            );
          })}
        </div>
      </CardContent>
      <PlatformAppKeysDialog
        provider={provider}
        open={provider !== null}
        onOpenChange={(v) => !v && setProvider(null)}
      />
    </Card>
  );
}
