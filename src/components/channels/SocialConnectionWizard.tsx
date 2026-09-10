// The Add Channel wizard (Batch 2A).
//
//   1 Platform      social channels, with advertising & analytics kept apart
//   2 Permission    what Flas is asking for, in plain language; scope names
//                   only under "Advanced permission details"
//   → the provider's own sign-in and consent screen
//   3-5 Select / Confirm / Connected happen on return, in ChannelPicker
//
// Every capability shown comes from the registry. A platform whose connector
// has not moved to the channel model yet still connects, through the older
// flow, and says so rather than pretending to be the new experience.
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { connector } from "@/lib/connections-catalog";
import { hasNoImplementedCapability } from "@/lib/social-channel-capabilities";
import { startConnect } from "@/lib/connections.functions";
import {
  CAPABILITY_LABELS,
  connectorDefinition,
  initialTierIds,
  scopesForTiers,
  usesChannelModel,
  type AuthorizationTier,
  type CapabilityKey,
} from "@/lib/social-connector-definitions";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Check, Loader2, Minus, ShieldCheck } from "lucide-react";
import { useState } from "react";

export const SOCIAL_PLATFORMS = [
  "facebook",
  "instagram",
  "threads",
  "linkedin",
  "tiktok",
  "youtube",
  "twitter",
  "google_business",
  "pinterest",
] as const;

export const ADS_AND_ANALYTICS = [
  "meta_ads",
  "google_ads",
  "linkedin_ads",
  "tiktok_ads",
  "google_analytics",
  "search_console",
] as const;

const SIGN_IN_LABEL: Record<string, string> = {
  google: "Continue with Google",
  meta: "Continue with Facebook",
  linkedin: "Continue with LinkedIn",
  tiktok: "Continue with TikTok",
  twitter: "Continue with X",
  pinterest: "Continue with Pinterest",
};

const PROVIDER_NAME: Record<string, string> = {
  google: "Google",
  meta: "Facebook",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  twitter: "X",
  pinterest: "Pinterest",
};

/** What a connected channel of this platform can do in Flas, from the registry. */
function platformCapabilities(id: string) {
  const def = connectorDefinition(id);
  if (!def) return { available: [] as Array<{ label: string; review: boolean }>, unavailable: [] as string[] };
  const available: Array<{ label: string; review: boolean }> = [];
  const unavailable = new Set<string>();
  for (const key of Object.keys(def.capabilities) as CapabilityKey[]) {
    const facts = def.capabilities[key];
    if (facts.providerSupports && facts.flasImplements) {
      // The registry's own label, and a caveat when the provider must approve
      // the app first -- a plain tick would promise something that does not
      // work yet.
      available.push({ label: CAPABILITY_LABELS[key], review: facts.reviewRequired });
    } else if (!facts.providerSupports && facts.note && !/does not offer an API for this/.test(facts.note)) {
      // DM read and DM send usually share one reason; say it once.
      unavailable.add(facts.note);
    }
  }
  return { available, unavailable: [...unavailable] };
}

export type WizardIntent =
  | { kind: "add" }
  | { kind: "reconnect"; platform: string; accountId: string; channelName: string }
  | { kind: "upgrade"; platform: string; accountId: string; channelName: string; tierId: string };

export function SocialConnectionWizard({
  open,
  onOpenChange,
  intent = { kind: "add" },
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  intent?: WizardIntent;
}) {
  const start = useServerFn(startConnect);
  const [picked, setPicked] = useState<string | null>(intent.kind === "add" ? null : intent.platform);
  const [busy, setBusy] = useState(false);
  const [blocker, setBlocker] = useState<{ reason: string; missing: string[] } | null>(null);

  const platform = intent.kind === "add" ? picked : intent.platform;
  const def = platform ? connectorDefinition(platform) : undefined;
  const meta = platform ? connector(platform) : undefined;
  const providerName = meta?.provider ? (PROVIDER_NAME[meta.provider] ?? meta.provider) : "the platform";

  // The tiers this authorization will ask for.
  const tiers: AuthorizationTier[] = (() => {
    if (!def?.authorizationTiers) return [];
    if (intent.kind === "upgrade") {
      return def.authorizationTiers.filter((t) => t.id === intent.tierId);
    }
    const ids = initialTierIds(def);
    return def.authorizationTiers.filter((t) => ids.includes(t.id));
  })();
  const scopes = (() => {
    if (!def) return [] as string[];
    try {
      return def.authorizationTiers?.length
        ? scopesForTiers(def, tiers.map((t) => t.id))
        : [...def.requestedScopes];
    } catch {
      return [];
    }
  })();

  async function authorize() {
    if (!platform) return;
    setBusy(true);
    setBlocker(null);
    try {
      const result = await start({
        data: {
          platform: platform as never,
          origin: window.location.origin,
          ...(intent.kind === "reconnect" ? { purpose: "reconnect" as const, accountId: intent.accountId } : {}),
          ...(intent.kind === "upgrade"
            ? { purpose: "upgrade" as const, accountId: intent.accountId, tierIds: [intent.tierId] }
            : {}),
        },
      });
      if (result.ready) {
        window.location.assign(result.url);
        return;
      }
      setBlocker({ reason: result.reason, missing: result.missing });
    } catch (e) {
      setBlocker({ reason: e instanceof Error ? e.message : "Could not start the sign-in.", missing: [] });
    } finally {
      setBusy(false);
    }
  }

  const close = (v: boolean) => {
    if (!v) {
      setPicked(null);
      setBlocker(null);
    }
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        {!platform ? (
          <>
            <DialogHeader>
              <DialogTitle>Add a channel</DialogTitle>
              <DialogDescription>
                Choose a platform. You will sign in on the platform itself — Flas never asks for a
                password, token or channel ID.
              </DialogDescription>
            </DialogHeader>
            <PlatformGrid ids={SOCIAL_PLATFORMS} onPick={setPicked} />
            <h3 className="mt-6 text-sm font-semibold text-muted-foreground">
              Advertising &amp; Analytics
            </h3>
            <PlatformGrid ids={ADS_AND_ANALYTICS} onPick={setPicked} compact />
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                {intent.kind === "upgrade"
                  ? `Enable ${tiers[0]?.label ?? "more access"}`
                  : intent.kind === "reconnect"
                    ? `Reconnect ${intent.channelName}`
                    : `Connect ${def?.displayName ?? platform}`}
              </DialogTitle>
              <DialogDescription>
                {intent.kind === "reconnect"
                  ? `Sign in again with the ${providerName} account that manages ${intent.channelName}. Its history, drafts and settings are kept.`
                  : `You will sign in with ${providerName} and approve access there.`}
              </DialogDescription>
            </DialogHeader>

            {tiers.length > 0 ? (
              <div className="grid gap-3">
                {tiers.map((t) => (
                  <div key={t.id} className="rounded-lg border p-4">
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      <ShieldCheck className="size-4 text-brand" /> {t.label}
                    </p>
                    <p className="mt-1.5 text-sm text-muted-foreground">{t.purpose}</p>
                    {t.scopeCaveat && (
                      <p className="mt-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                        {t.scopeCaveat}
                      </p>
                    )}
                    {t.wontDo?.length ? (
                      <div className="mt-2 text-xs text-muted-foreground">
                        Flas will not:
                        <ul className="mt-1 list-inside list-disc">
                          {t.wontDo.map((w) => (
                            <li key={w}>{w}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border p-4 text-sm text-muted-foreground">
                {def?.displayName ?? platform} still uses the previous connection flow; its guided
                channel picker arrives in a later update. You will return to the Social Hub.
              </p>
            )}

            {platform && usesChannelModel(platform) && intent.kind === "add" && (
              <p className="text-xs text-muted-foreground">
                {providerName} will ask which account to use. If you manage a brand or company
                channel, choose it there — the Google email you sign in with does not have to match
                the channel&apos;s name.
              </p>
            )}

            <details className="rounded-lg border p-3 text-xs">
              <summary className="cursor-pointer font-medium">Advanced permission details</summary>
              <ul className="mt-2 grid gap-1 font-mono text-[11px] text-muted-foreground">
                {scopes.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </details>

            {blocker && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <p>{blocker.reason}</p>
                {blocker.missing.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    A Flas administrator needs to set: {blocker.missing.join(", ")}
                  </p>
                )}
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              {intent.kind === "add" ? (
                <Button variant="ghost" size="sm" onClick={() => setPicked(null)}>
                  <ArrowLeft className="size-4" /> Back
                </Button>
              ) : (
                <span />
              )}
              <Button onClick={() => void authorize()} disabled={busy || !meta?.oauth}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                {meta?.provider ? (SIGN_IN_LABEL[meta.provider] ?? "Continue") : "Continue"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PlatformGrid({
  ids,
  onPick,
  compact = false,
}: {
  ids: readonly string[];
  onPick: (id: string) => void;
  compact?: boolean;
}) {
  return (
    <div className={`grid gap-3 ${compact ? "sm:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
      {ids.map((id) => {
        const def = connectorDefinition(id);
        const meta = connector(id);
        if (!def || !meta) return null;
        const { available, unavailable } = platformCapabilities(id);
        const disabledReason =
          meta.unavailableReason ??
          (!meta.oauth ? "Set up from Integrations." : null) ??
          // A platform with no Flas feature at all gets no Connect button:
          // connecting would store access nothing uses.
          (hasNoImplementedCapability(def)
            ? "Not available yet: Flas has no features for this platform, so connecting would store access it cannot use."
            : null);
        return (
          <div key={id} className="flex flex-col rounded-lg border p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">{def.displayName}</p>
                <p className="text-xs text-muted-foreground">{def.accountTypes[0]}</p>
              </div>
              {usesChannelModel(id) && (
                <Badge variant="secondary" className="text-[10px]">
                  Guided
                </Badge>
              )}
            </div>
            {!compact && (
              <ul className="mt-3 grid flex-1 gap-1 text-xs">
                {available.slice(0, 5).map((a) => (
                  <li key={a.label} className="flex items-center gap-1.5">
                    <Check className="size-3 text-brand" /> {a.label}
                    {a.review && (
                      <span className="text-muted-foreground">· after provider review</span>
                    )}
                  </li>
                ))}
                {unavailable.slice(0, 2).map((u) => (
                  <li key={u} className="flex items-center gap-1.5 text-muted-foreground">
                    <Minus className="size-3" /> {u}
                  </li>
                ))}
              </ul>
            )}
            <Button
              size="sm"
              className="mt-3"
              variant={disabledReason ? "outline" : "default"}
              disabled={Boolean(disabledReason)}
              title={disabledReason ?? undefined}
              onClick={() => onPick(id)}
            >
              {disabledReason ? "Not available" : `Connect ${def.displayName}`}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
