import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { connectorIcon } from "@/components/integrations/connector-icons";
import { PlatformAppsCard, ProviderKey, redirectUri } from "@/components/integrations/PlatformAppsCard";
import { CONNECTORS, type Connector, type ConnectorGroup } from "@/lib/connections-catalog";
import { connectionStatus } from "@/lib/connection-status";
import { disconnectConnection, getConnections, getConnectReadiness, startConnect } from "@/lib/connections.functions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Copy,
  ExternalLink,
  KeyRound,
  Link2,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type Account = {
  id: string;
  platform: string;
  label: string;
  external_id?: string | null;
  active: boolean;
  health: string;
  last_synced_at: string | null;
  token_expires_at: string | null;
  permissions: string[] | null;
  profile_url: string | null;
  connect_method: string;
};

type Readiness = {
  id: string;
  name: string;
  provider: string;
  ready: boolean;
  missing: string[];
  source: string;
};

const GROUP_LABELS: Record<ConnectorGroup, string> = {
  social: "Social",
  messaging: "Messaging",
  ads: "Advertising",
  analytics: "Analytics",
  commerce: "Website & Commerce",
};

const POPULAR = new Set(["facebook", "instagram", "youtube", "whatsapp", "linkedin", "google_business"]);

function friendlyCapability(platform: string): string[] {
  switch (platform) {
    case "facebook":
      return ["Page profile", "Posts", "Analytics"];
    case "instagram":
      return ["Profile", "Posts & Reels", "Insights"];
    case "youtube":
      return ["Channel", "Videos", "Analytics"];
    case "linkedin":
      return ["Company Page", "Posts", "Analytics"];
    case "google_business":
      return ["Business profile", "Reviews", "Performance"];
    case "meta_ads":
      return ["Campaigns", "Spend", "Performance"];
    case "google_analytics":
      return ["Traffic", "Sources", "Conversions"];
    case "search_console":
      return ["Clicks", "Impressions", "Queries"];
    case "whatsapp":
      return ["Conversations", "Templates", "Inbox"];
    default:
      return ["Profile access"];
  }
}

function isNeedsAttention(account: Account) {
  const state = connectionStatus(account);
  return state.tone === "bad" || state.tone === "warn";
}

function humanTime(value: string | null) {
  if (!value) return "Not yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not yet";
  return date.toLocaleString();
}

export function IntegrationsV2() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const connections = useQuery({ queryKey: ["connections"], queryFn: () => getConnections() });
  const readiness = useQuery({ queryKey: ["connect-readiness"], queryFn: () => getConnectReadiness() });
  const start = useServerFn(startConnect);
  const disconnect = useServerFn(disconnectConnection);
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);
  const [providerSetupOpen, setProviderSetupOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"popular" | ConnectorGroup>("popular");
  const [connecting, setConnecting] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ platform: string; reason: string } | null>(null);

  const accounts = ((connections.data?.accounts ?? []) as Account[]).filter((a) => a.active);
  const attention = accounts.filter(isNeedsAttention);
  const readyRows = (readiness.data ?? []) as Readiness[];
  const readyMap = new Map(readyRows.map((r) => [r.id, r]));
  const available = CONNECTORS.filter((c) => !c.unavailableReason).length;
  const comingSoon = CONNECTORS.filter((c) => Boolean(c.unavailableReason)).length;

  const marketplaceItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CONNECTORS.filter((c) => {
      if (category === "popular" && !POPULAR.has(c.id)) return false;
      if (category !== "popular" && c.group !== category) return false;
      if (!q) return true;
      return `${c.name} ${c.blurb} ${GROUP_LABELS[c.group]}`.toLowerCase().includes(q);
    });
  }, [category, query]);

  const connect = useMutation({
    mutationFn: async (platform: string) => {
      setConnecting(platform);
      setBlocked(null);
      return start({ data: { platform: platform as never, origin: window.location.origin } });
    },
    onSuccess: (result, platform) => {
      setConnecting(null);
      if (!result.ready) {
        setBlocked({ platform, reason: result.reason });
        return;
      }
      const opened = window.open(result.url, "_blank", "noopener,noreferrer");
      if (!opened) {
        setBlocked({ platform, reason: "Your browser blocked the secure sign-in window. Allow pop-ups for FLAS and try again." });
        return;
      }
      toast.info("Finish sign-in with the provider. FLAS will show the connection after the callback completes.");
      window.setTimeout(() => {
        void qc.invalidateQueries({ queryKey: ["connections"] });
        void qc.invalidateQueries({ queryKey: ["connect-readiness"] });
      }, 3500);
    },
    onError: (e: Error, platform) => {
      setConnecting(null);
      setBlocked({ platform, reason: e.message });
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => disconnect({ data: { id } }),
    onSuccess: () => {
      toast.success("Disconnected. Existing FLAS history is kept.");
      void qc.invalidateQueries({ queryKey: ["connections"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <PageHeader
            title="Integrations"
            description="Connect the tools your team uses and manage every account from one clear place."
          />
          <div className="flex flex-wrap gap-2">
            {isAdmin && (
              <Button variant="outline" onClick={() => setProviderSetupOpen(true)}>
                <Settings2 className="mr-2 size-4" /> Provider setup
              </Button>
            )}
            <Button onClick={() => setMarketplaceOpen(true)}>
              <Plus className="mr-2 size-4" /> Add Integration
            </Button>
          </div>
        </div>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Connected" value={accounts.length} tone="good" />
          <StatCard label="Needs attention" value={attention.length} tone={attention.length ? "warn" : "muted"} />
          <StatCard label="Available" value={available} tone="muted" />
          <StatCard label="Coming soon" value={comingSoon} tone="muted" />
        </section>

        {attention.length > 0 && (
          <section className="space-y-3">
            <SectionHeading title="Needs attention" description="Fix these first so your automations and reporting keep working." />
            <div className="grid gap-3">
              {attention.map((account) => {
                const state = connectionStatus(account);
                const meta = CONNECTORS.find((c) => c.id === account.platform);
                const { icon: Icon, tint } = connectorIcon(account.platform);
                return (
                  <Card key={account.id} className="border-amber-300/60">
                    <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-background">
                          <Icon className={`size-5 ${tint}`} />
                        </span>
                        <div className="min-w-0">
                          <p className="font-semibold">{account.label || meta?.name || account.platform}</p>
                          <p className="text-sm text-muted-foreground">{meta?.name ?? account.platform}</p>
                          <p className="mt-1 text-sm">{state.reason}</p>
                        </div>
                      </div>
                      <Button size="sm" onClick={() => meta && connect.mutate(meta.id)} disabled={!meta?.oauth || connecting === meta?.id}>
                        <RefreshCw className="mr-2 size-4" /> Fix connection
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        )}

        <section className="space-y-3">
          <SectionHeading title="Connected integrations" description="Accounts and channels currently linked to this workspace." />
          {connections.isLoading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-56 rounded-xl" />)}
            </div>
          ) : accounts.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-muted"><Link2 className="size-5" /></div>
                <div>
                  <p className="font-semibold">Connect your first integration</p>
                  <p className="mt-1 max-w-md text-sm text-muted-foreground">Bring Facebook, Instagram, YouTube, WhatsApp and more into FLAS.</p>
                </div>
                <Button onClick={() => setMarketplaceOpen(true)}><Plus className="mr-2 size-4" /> Add Integration</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {accounts.map((account) => (
                <ConnectedCard key={account.id} account={account} disconnecting={remove.isPending} onReconnect={() => connect.mutate(account.platform)} onDisconnect={() => remove.mutate(account.id)} />
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <SectionHeading title="Explore integrations" description="Add another channel without touching developer settings." />
            <Button variant="ghost" size="sm" onClick={() => setMarketplaceOpen(true)}>View all <ArrowRight className="ml-1 size-4" /></Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {CONNECTORS.filter((c) => POPULAR.has(c.id)).slice(0, 6).map((c) => (
              <MarketplacePreview key={c.id} connector={c} onClick={() => { setCategory("popular"); setQuery(c.name); setMarketplaceOpen(true); }} />
            ))}
          </div>
        </section>
      </div>

      <Dialog open={marketplaceOpen} onOpenChange={(open) => { setMarketplaceOpen(open); if (!open) { setQuery(""); setBlocked(null); } }}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Integration</DialogTitle>
            <DialogDescription>Choose a platform. FLAS will guide you through the shortest secure connection path.</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search integrations..." value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            {[{ id: "popular", label: "Popular" }, ...Object.entries(GROUP_LABELS).map(([id, label]) => ({ id, label }))].map((item) => (
              <Button key={item.id} size="sm" variant={category === item.id ? "default" : "outline"} onClick={() => { setCategory(item.id as "popular" | ConnectorGroup); setQuery(""); }}>
                {item.label}
              </Button>
            ))}
          </div>

          {blocked && (
            <div className="rounded-xl border border-amber-300/60 bg-amber-50/60 p-4 dark:bg-amber-950/10">
              <div className="flex gap-3">
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
                <div>
                  <p className="font-medium">This connection needs setup before it can continue</p>
                  <p className="mt-1 text-sm text-muted-foreground">{isAdmin ? blocked.reason : "A FLAS administrator needs to finish the platform configuration. Please try again after setup is completed."}</p>
                  {isAdmin && <Button className="mt-3" size="sm" variant="outline" onClick={() => setProviderSetupOpen(true)}>Open Provider Setup</Button>}
                </div>
              </div>
            </div>
          )}

          {marketplaceItems.length === 0 ? (
            <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">No integrations match your search.</div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {marketplaceItems.map((connector) => (
                <MarketplaceCard
                  key={connector.id}
                  connector={connector}
                  readiness={readyMap.get(connector.id) ?? null}
                  connecting={connecting === connector.id}
                  onConnect={() => connector.oauth ? connect.mutate(connector.id) : connector.internalHref ? (window.location.href = connector.internalHref) : toast.info(`${connector.name} uses guided setup outside OAuth.`)}
                />
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={providerSetupOpen} onOpenChange={setProviderSetupOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Provider Setup</DialogTitle>
            <DialogDescription>Admin-only readiness for shared OAuth providers. Secrets are never shown here.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from(new Map(readyRows.map((r) => [r.provider, r])).values()).map((row) => (
              <Card key={row.provider}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="capitalize">{row.provider}</CardTitle>
                    <Badge variant={row.ready ? "default" : "secondary"}>{row.ready ? "Configured" : "Setup needed"}</Badge>
                  </div>
                  <CardDescription>{row.source === "workspace" ? "Workspace credentials" : row.source === "shared" ? "Shared FLAS credentials" : "No credentials configured"}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex items-center gap-2"><ShieldCheck className="size-4" /><span>Client secret: {row.ready ? "Configured" : "Missing"}</span></div>
                  {!row.ready && <p className="text-muted-foreground">Add this provider's App/Client ID and Secret in the secure provider settings, then retry the connection.</p>}
                  <Button variant="outline" size="sm" onClick={() => setMarketplaceOpen(true)}>View integrations</Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return <div><h2 className="text-lg font-semibold tracking-tight">{title}</h2><p className="text-sm text-muted-foreground">{description}</p></div>;
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: "good" | "warn" | "muted" }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p></div>
        <span className={`size-2.5 rounded-full ${tone === "good" ? "bg-emerald-500" : tone === "warn" ? "bg-amber-500" : "bg-muted-foreground/30"}`} />
      </CardContent>
    </Card>
  );
}

function ConnectedCard({ account, disconnecting, onReconnect, onDisconnect }: { account: Account; disconnecting: boolean; onReconnect: () => void; onDisconnect: () => void }) {
  const meta = CONNECTORS.find((c) => c.id === account.platform);
  const state = connectionStatus(account);
  const { icon: Icon, tint } = connectorIcon(account.platform);
  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border bg-background"><Icon className={`size-5 ${tint}`} /></span>
            <div className="min-w-0"><CardTitle className="truncate text-base">{account.label || meta?.name || account.platform}</CardTitle><CardDescription>{meta?.name ?? account.platform}</CardDescription></div>
          </div>
          <Badge variant={state.tone === "good" ? "default" : state.tone === "bad" ? "destructive" : "secondary"}>{state.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 text-xs"><div><p className="text-muted-foreground">Last verified</p><p className="mt-1 font-medium">{humanTime(account.last_synced_at)}</p></div><div><p className="text-muted-foreground">Last sync</p><p className="mt-1 font-medium">{humanTime(account.last_synced_at)}</p></div></div>
        <div className="flex flex-wrap gap-1.5">{friendlyCapability(account.platform).map((cap) => <Badge key={cap} variant="secondary" className="font-normal">{cap}</Badge>)}</div>
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          {account.profile_url && <Button asChild size="sm" variant="outline"><a href={account.profile_url} target="_blank" rel="noreferrer noopener">Open <ExternalLink className="ml-1 size-3.5" /></a></Button>}
          {meta?.oauth && <Button size="sm" variant="outline" onClick={onReconnect}><RefreshCw className="mr-1 size-3.5" /> Reconnect</Button>}
          <Button size="sm" variant="ghost" className="text-destructive" disabled={disconnecting} onClick={onDisconnect}><Unplug className="mr-1 size-3.5" /> Disconnect</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MarketplacePreview({ connector, onClick }: { connector: Connector; onClick: () => void }) {
  const { icon: Icon, tint } = connectorIcon(connector.id);
  return <button type="button" onClick={onClick} className="flex items-center gap-3 rounded-xl border p-4 text-left transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="flex size-10 items-center justify-center rounded-xl border bg-background"><Icon className={`size-5 ${tint}`} /></span><span><span className="block font-medium">{connector.name}</span><span className="line-clamp-1 text-xs text-muted-foreground">{connector.blurb}</span></span></button>;
}

function MarketplaceCard({ connector, readiness, connecting, onConnect }: { connector: Connector; readiness: Readiness | null; connecting: boolean; onConnect: () => void }) {
  const { icon: Icon, tint } = connectorIcon(connector.id);
  const comingSoon = Boolean(connector.unavailableReason);
  const needsAdminSetup = Boolean(connector.oauth && readiness && !readiness.ready);
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2"><span className="flex size-11 items-center justify-center rounded-xl border bg-background"><Icon className={`size-5 ${tint}`} /></span>{comingSoon ? <Badge variant="outline">Coming soon</Badge> : needsAdminSetup ? <Badge variant="secondary">Admin setup</Badge> : <Badge variant="secondary">Available</Badge>}</div>
        <CardTitle className="pt-2 text-base">{connector.name}</CardTitle>
        <CardDescription>{connector.blurb}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <div className="space-y-1 text-xs text-muted-foreground">{friendlyCapability(connector.id).slice(0, 3).map((cap) => <div key={cap} className="flex items-center gap-1.5"><CheckCircle2 className="size-3.5 text-emerald-600" /> {cap}</div>)}</div>
        <div className="mt-auto pt-2">
          {comingSoon ? <Button className="w-full" variant="outline" disabled>Coming soon</Button> : <Button className="w-full" onClick={onConnect} disabled={connecting}>{connecting ? "Opening secure sign-in…" : connector.oauth ? `Connect ${connector.name}` : connector.internalHref ? "Open setup" : "Set up"}</Button>}
        </div>
      </CardContent>
    </Card>
  );
}
