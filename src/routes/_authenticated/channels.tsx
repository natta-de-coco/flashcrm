// Social Channels — the connection manager (Batch 2A).
//
// One screen for every connected channel: what it is, whether it works, what
// Flas can do with it right now, and the one action that fixes it. Capability
// rows come only from the registry plus the scopes actually granted; nothing is
// shown as available that the provider or Flas cannot do.
import { PageHeader } from "@/components/PageHeader";
import { ChannelPicker } from "@/components/channels/ChannelPicker";
import {
  SocialConnectionWizard,
  type WizardIntent,
} from "@/components/channels/SocialConnectionWizard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSocialChannels } from "@/lib/channels.functions";
import { disconnectConnection } from "@/lib/connections.functions";
import { CONNECTION_STATE_INFO, type ConnectionState } from "@/lib/connection-state";
import {
  capabilitySummary,
  channelCapabilities,
  upgradeOptions,
} from "@/lib/social-channel-capabilities";
import { connectorDefinition, usesChannelModel } from "@/lib/social-connector-definitions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, Circle, Loader2, Minus, Plus, RefreshCw, Unplug } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type Search = {
  authorization?: string;
  step?: string;
  reason?: string;
  reconnected?: string;
  account?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/_authenticated/channels")({
  head: () => ({ meta: [{ title: "Social Channels — Flas CRM" }] }),
  // Only an opaque authorization id and fixed codes ever arrive here.
  validateSearch: (s: Record<string, unknown>): Search => ({
    ...(typeof s["authorization"] === "string" && UUID.test(s["authorization"])
      ? { authorization: s["authorization"] }
      : {}),
    ...(typeof s["step"] === "string" && /^[a-z_]{1,20}$/.test(s["step"]) ? { step: s["step"] } : {}),
    ...(typeof s["reason"] === "string" && /^[a-z_]{1,40}$/.test(s["reason"]) ? { reason: s["reason"] } : {}),
    ...(typeof s["reconnected"] === "string" && /^[a-z_]{1,32}$/.test(s["reconnected"])
      ? { reconnected: s["reconnected"] }
      : {}),
  }),
  component: SocialChannelsPage,
});

type Account = {
  id: string;
  platform: string;
  label: string;
  external_id: string | null;
  active: boolean;
  profile: { picture?: string; username?: string } | null;
  account_type: string | null;
  authorization_id: string | null;
  connection_state: string;
  last_validation_success_at: string | null;
  granted_scopes: string[] | null;
  legacy_manual_connection: boolean;
};

type Authorization = {
  id: string;
  provider_email_hint: string | null;
  requested_scopes: string[];
  granted_scopes: string[];
  authorization_state: string;
};

const NEEDS_RECONNECT = new Set(["revoked", "refresh_failed", "authorization_cancelled", "callback_error"]);

function timeAgo(iso: string | null) {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h} hour${h === 1 ? "" : "s"} ago` : `${Math.round(h / 24)} days ago`;
}

function SocialChannelsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const qc = useQueryClient();
  const fetchChannels = useServerFn(getSocialChannels);
  const q = useQuery({ queryKey: ["social-channels"], queryFn: () => fetchChannels() });
  const [wizard, setWizard] = useState<WizardIntent | null>(null);
  const clearSearch = () => void navigate({ to: "/channels", search: {}, replace: true });
  const refresh = () => qc.invalidateQueries({ queryKey: ["social-channels"] });

  const accounts = ((q.data?.accounts ?? []) as unknown as Account[]).filter((a) => a.active);
  const auths = (q.data?.authorizations ?? []) as unknown as Authorization[];
  const authById = new Map(auths.map((a) => [a.id, a]));

  const rows = accounts.map((a) => {
    const def = connectorDefinition(a.platform);
    const auth = a.authorization_id ? authById.get(a.authorization_id) : undefined;
    const granted = auth?.granted_scopes ?? a.granted_scopes ?? [];
    const requested = auth?.requested_scopes ?? granted;
    const caps = def ? channelCapabilities(def, granted, requested) : [];
    return { a, def, auth, caps, summary: capabilitySummary(caps) };
  });

  const counts = {
    connected: rows.length,
    healthy: rows.filter((r) => r.a.connection_state === "connected" && r.a.last_validation_success_at).length,
    needPermission: rows.filter((r) => r.caps.some((c) => c.state === "declined")).length,
    reconnect: rows.filter((r) => NEEDS_RECONNECT.has(r.a.connection_state)).length,
  };

  const byPlatform = new Map<string, typeof rows>();
  for (const r of rows) byPlatform.set(r.a.platform, [...(byPlatform.get(r.a.platform) ?? []), r]);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-6">
      <PageHeader
        title="Social Channels"
        description="Connect the channels this workspace manages, and see exactly what Flas can do with each."
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{counts.connected} channels connected</Badge>
        <Badge variant="secondary">{counts.healthy} verified and working</Badge>
        {counts.needPermission > 0 && <Badge variant="outline">{counts.needPermission} need permission</Badge>}
        {counts.reconnect > 0 && <Badge variant="destructive">{counts.reconnect} need reconnection</Badge>}
        <Button className="ml-auto" onClick={() => setWizard({ kind: "add" })}>
          <Plus className="size-4" /> Add Channel
        </Button>
      </div>

      {search.reconnected && (
        <Card className="mt-4 border-primary/40">
          <CardContent className="flex items-center justify-between gap-2 pt-6 text-sm">
            <span>Reconnected. Its history, drafts and settings were kept.</span>
            <Button size="sm" variant="ghost" onClick={clearSearch}>
              Dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      {search.authorization && (
        <ChannelPicker
          authorizationId={search.authorization}
          onDone={() => {
            clearSearch();
            void refresh();
          }}
          onSignInAgain={(platform) => {
            clearSearch();
            setWizard({ kind: "reconnect", platform, accountId: "", channelName: "" });
          }}
        />
      )}

      {q.isLoading && (
        <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading channels…
        </p>
      )}

      {!q.isLoading && rows.length === 0 && !search.authorization && (
        <Card className="mt-6">
          <CardContent className="grid gap-3 pt-6 text-sm">
            <p>No channels connected yet.</p>
            <Button className="w-fit" onClick={() => setWizard({ kind: "add" })}>
              <Plus className="size-4" /> Add your first channel
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="mt-6 grid gap-6">
        {[...byPlatform.entries()].map(([platform, group]) => (
          <section key={platform}>
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
              {connectorDefinition(platform)?.displayName ?? platform}
            </h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {group.map((r) => (
                <ChannelCard
                  key={r.a.id}
                  row={r}
                  onReconnect={() =>
                    setWizard({ kind: "reconnect", platform, accountId: r.a.id, channelName: r.a.label })
                  }
                  onEnable={(tierId) =>
                    setWizard({ kind: "upgrade", platform, accountId: r.a.id, channelName: r.a.label, tierId })
                  }
                  onChanged={refresh}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {wizard && (
        <SocialConnectionWizard
          open
          intent={
            // "Use another account" from the picker has no channel yet: it is
            // a fresh connection for that platform.
            wizard.kind === "reconnect" && !wizard.accountId ? { kind: "add" } : wizard
          }
          onOpenChange={(v) => !v && setWizard(null)}
        />
      )}
    </main>
  );
}

function ChannelCard({
  row,
  onReconnect,
  onEnable,
  onChanged,
}: {
  row: {
    a: Account;
    def: ReturnType<typeof connectorDefinition>;
    auth: Authorization | undefined;
    caps: ReturnType<typeof channelCapabilities>;
    summary: ReturnType<typeof capabilitySummary>;
  };
  onReconnect: () => void;
  onEnable: (tierId: string) => void;
  onChanged: () => void;
}) {
  const { a, def, auth, caps, summary } = row;
  const disconnect = useServerFn(disconnectConnection);
  const [manage, setManage] = useState(false);
  const state = a.connection_state as ConnectionState;
  const info = CONNECTION_STATE_INFO[state] ?? CONNECTION_STATE_INFO.not_configured;
  const reconnectNeeded = NEEDS_RECONNECT.has(state);
  const unverified = !a.last_validation_success_at || a.legacy_manual_connection;

  const disconnectMutation = useMutation({
    mutationFn: () => disconnect({ data: { id: a.id } }),
    onSuccess: () => {
      toast.success(`${a.label} disconnected — its history is kept`);
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const upgrades = def ? upgradeOptions(def, auth?.granted_scopes ?? a.granted_scopes ?? []) : [];

  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3 space-y-0">
        {a.profile?.picture ? (
          <img src={a.profile.picture} alt="" className="size-10 rounded-full" loading="lazy" />
        ) : (
          <div className="size-10 rounded-full bg-muted" />
        )}
        <div className="min-w-0 flex-1">
          <CardTitle className="truncate text-base">{a.label}</CardTitle>
          <p className="text-xs text-muted-foreground">
            {a.profile?.username ? `${a.profile.username} · ` : ""}
            {a.account_type ?? def?.accountTypes[0] ?? ""}
          </p>
          {auth?.provider_email_hint && (
            <p className="text-xs text-muted-foreground">Authorized by {auth.provider_email_hint}</p>
          )}
        </div>
        <Badge variant={reconnectNeeded ? "destructive" : unverified ? "outline" : "secondary"}>
          {reconnectNeeded ? "Reconnection required" : unverified ? "Not yet verified" : info.label}
        </Badge>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-xs text-muted-foreground">
          {reconnectNeeded ? info.description : `Connected — ${summary.label}`} · Last checked{" "}
          {timeAgo(a.last_validation_success_at)}
        </p>
        <ul className="grid gap-1 text-xs sm:grid-cols-2">
          {caps.map((c) => (
            <li key={c.key} className="flex items-center gap-1.5" title={c.note ?? undefined}>
              {c.state === "available" ? (
                <Check className="size-3 text-brand" />
              ) : c.state === "needs_permission" || c.state === "declined" ? (
                <Circle className="size-3 text-muted-foreground" />
              ) : (
                <Minus className="size-3 text-muted-foreground" />
              )}
              <span className={c.state === "available" ? "" : "text-muted-foreground"}>{c.label}</span>
              {c.state === "declined" && <span className="text-destructive">declined</span>}
            </li>
          ))}
        </ul>

        {manage && (
          <div className="rounded-lg border p-3 text-sm">
            <p className="mb-2 font-medium">Optional access</p>
            {upgrades.length === 0 && (
              <p className="text-xs text-muted-foreground">Nothing more to enable for this channel.</p>
            )}
            {upgrades.map((u) => (
              <div key={u.tier.id} className="flex items-center justify-between gap-2 py-1">
                <span className="text-xs">{u.tier.label}</span>
                {u.enabled ? (
                  <Badge variant="secondary" className="text-[10px]">
                    Enabled
                  </Badge>
                ) : u.offerable ? (
                  <Button size="sm" variant="outline" onClick={() => onEnable(u.tier.id)}>
                    Enable
                  </Button>
                ) : (
                  <span className="text-[11px] text-muted-foreground">{u.reason}</span>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {usesChannelModel(a.platform) && (
            <Button size="sm" variant="outline" onClick={() => setManage((v) => !v)}>
              {manage ? "Close" : "Manage"}
            </Button>
          )}
          {usesChannelModel(a.platform) && (
            <Button size="sm" variant={reconnectNeeded ? "default" : "ghost"} onClick={onReconnect}>
              <RefreshCw className="size-3.5" /> Reconnect
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={disconnectMutation.isPending}
            onClick={() => disconnectMutation.mutate()}
          >
            <Unplug className="size-3.5" /> Disconnect
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
