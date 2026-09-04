import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CONNECTORS, type Connector, type ConnectorGroup } from "@/lib/connections-catalog";
import { ConnectionWizard } from "@/components/integrations/ConnectionWizard";
import { HealthReportDialog } from "@/components/integrations/HealthReportDialog";
import {
  PlatformAppKeysDialog,
  PlatformAppsCard,
  type ProviderKey,
  type ProviderReady,
} from "@/components/integrations/PlatformAppsCard";
import { setupGuide } from "@/lib/connection-setup";
import { connectionStatus } from "@/lib/connection-status";
import {
  disconnectConnection,
  getConnections,
  optimizeConnectedProfile,
  scanConnectedAccount,
  startConnect,
} from "@/lib/connections.functions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  ExternalLink,
  Link2,
  Megaphone,
  MessageSquare,
  ShoppingBag,
  Sparkles,
  Unplug,
  Wand2,
  KeyRound,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const GROUPS: {
  id: ConnectorGroup;
  title: string;
  blurb: string;
  icon: typeof Megaphone;
}[] = [
  {
    id: "social",
    title: "Social profiles",
    blurb: "Publish posts, pull reach and answer DMs and comments inside Flas.",
    icon: Megaphone,
  },
  {
    id: "messaging",
    title: "Messaging",
    blurb: "WhatsApp and website chat — every conversation lands in your Inbox.",
    icon: MessageSquare,
  },
  {
    id: "ads",
    title: "Ads accounts",
    blurb: "Read spend and results so Flas can advise on what to scale.",
    icon: BarChart3,
  },
  {
    id: "analytics",
    title: "Analytics & search",
    blurb: "Traffic and search data feed the Business Advisor and SEO Studio.",
    icon: BarChart3,
  },
  {
    id: "commerce",
    title: "Website & stores",
    blurb: "WordPress, Shopify and WooCommerce plugins for leads and publishing.",
    icon: ShoppingBag,
  },
];

type Account = {
  id: string;
  platform: string;
  label: string;
  health: string;
  connect_method: string;
  profile_url: string | null;
  last_synced_at: string | null;
  active: boolean;
  token_expires_at: string | null;
  permissions: string[] | null;
};

/**
 * The single place where every Flas integration is connected, grouped by what
 * it does. Each card says plainly what the link gives you and where it goes.
 */
export function ConnectBusiness() {
  const qc = useQueryClient();
  const connections = useQuery({ queryKey: ["connections"], queryFn: () => getConnections() });
  const start = useServerFn(startConnect);
  const scan = useServerFn(scanConnectedAccount);
  const optimize = useServerFn(optimizeConnectedProfile);
  const disconnect = useServerFn(disconnectConnection);
  const [optimizerFor, setOptimizerFor] = useState<string | null>(null);
  const [optimizerText, setOptimizerText] = useState<string>("");
  const [keysFor, setKeysFor] = useState<ProviderKey | null>(null);

  const connect = useMutation({
    mutationFn: async (platform: string) =>
      start({ data: { platform: platform as never, origin: window.location.origin } }),
    onSuccess: (result) => {
      if (result.ready) {
        // Providers like Facebook/Google refuse to render inside an iframe
        // (ERR_BLOCKED_BY_RESPONSE), so always hand off to a real browser tab.
        const opened = window.open(result.url, "_blank", "noopener,noreferrer");
        if (!opened) {
          toast.error("Allow pop-ups, then click Connect again to open the secure login page.");
          return;
        }
        toast.info("Finish signing in on the new tab, then come back here.");
        return;
      }
      toast.info(result.reason);
    },

    onError: (e: Error) => toast.error(e.message),
  });

  const runScan = useMutation({
    mutationFn: async (id: string) => scan({ data: { id } }),
    onSuccess: (r: { overall: number }) => {
      toast.success(`Flas scan complete — profile score ${r.overall}/100`);
      void qc.invalidateQueries({ queryKey: ["connections"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runOptimize = useMutation({
    mutationFn: async (id: string) => {
      setOptimizerFor(id);
      return optimize({ data: { id } });
    },
    onSuccess: (r: unknown) => setOptimizerText(JSON.stringify(r, null, 2)),
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => disconnect({ data: { id } }),
    onSuccess: () => {
      toast.success("Disconnected — history kept");
      void qc.invalidateQueries({ queryKey: ["connections"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const data = connections.data;
  const accounts = (data?.accounts ?? []) as Account[];
  const accountsFor = (id: string) => accounts.filter((a) => a.platform === id);
  const connectedCount = accounts.filter((a) => a.active).length;
  const providerReady = (data?.providerReady ?? {}) as ProviderReady;
  const isReady = (c: Connector) => (c.provider ? (providerReady[c.provider]?.ready ?? false) : true);

  return (
    <section id="platforms" className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Platform connections</h2>
          <p className="text-sm text-muted-foreground">
            Connect once — Flas then reads your data and works inside these accounts. Nothing is
            posted without your approval.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1.5">
            <Link2 className="size-3.5" /> {connectedCount} connected
          </Badge>
          <HealthReportDialog />
        </div>
      </div>

      <PlatformAppsCard providerReady={providerReady} />



      {connections.isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      )}

      {GROUPS.map((group) => {
        const items = CONNECTORS.filter((c) => c.group === group.id);
        if (items.length === 0) return null;
        return (
          <div key={group.id} className="grid gap-3">
            <div className="flex items-center gap-2">
              <group.icon className="size-4 text-primary" />
              <h3 className="text-sm font-semibold">{group.title}</h3>
              <span className="hidden text-xs text-muted-foreground sm:inline">{group.blurb}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((c) => (
                <ConnectorCard
                  key={c.id}
                  connector={c}
                  accounts={accountsFor(c.id)}
                  connecting={connect.isPending && connect.variables === c.id}
                  ready={isReady(c)}
                  onAddKeys={() => c.provider && setKeysFor(c.provider)}
                  onConnect={() => connect.mutate(c.id)}
                  onScan={(id) => runScan.mutate(id)}
                  onOptimize={(id) => runOptimize.mutate(id)}
                  onDisconnect={(id) => remove.mutate(id)}
                  busyId={runScan.isPending ? (runScan.variables as string) : null}
                />
              ))}
            </div>
          </div>
        );
      })}

      {optimizerFor && optimizerText && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Flas profile suggestions</CardTitle>
            <CardDescription>
              Copy these into the platform — bio, CTA and hashtags written from your brand training.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-3 text-xs">
              {optimizerText}
            </pre>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => {
                setOptimizerFor(null);
                setOptimizerText("");
              }}
            >
              Close
            </Button>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function ConnectorCard({
  connector,
  accounts,
  connecting,
  busyId,
  ready = true,
  onAddKeys,
  onConnect,
  onScan,
  onOptimize,
  onDisconnect,
}: {
  connector: Connector;
  accounts: Account[];
  connecting: boolean;
  busyId: string | null;
  ready?: boolean;
  onAddKeys?: () => void;
  onConnect: () => void;
  onScan: (id: string) => void;
  onOptimize: (id: string) => void;
  onDisconnect: (id: string) => void;
}) {
  const connected = accounts.some((a) => a.active);
  const [wizardOpen, setWizardOpen] = useState(false);
  // One clear state per card: Connected / Needs verification / Pending review /
  // Expired / Failing, always with the precise reason and the next action.
  const status = connectionStatus(accounts[0]);
  const guide = setupGuide(connector.id);
  return (
    <Card
      className={`flex h-full min-w-0 flex-col ${
        status.state === "connected" ? "border-primary/40" : ""
      }`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="min-w-0 break-words text-sm font-semibold">
            {connector.name}
          </CardTitle>
          <Badge
            variant={
              status.tone === "good"
                ? "default"
                : status.tone === "bad"
                  ? "destructive"
                  : status.tone === "warn"
                    ? "secondary"
                    : "outline"
            }
            className="shrink-0 gap-1 whitespace-nowrap"
          >
            {status.tone === "good" ? (
              <CheckCircle2 className="size-3" />
            ) : status.tone === "muted" ? null : (
              <AlertTriangle className="size-3" />
            )}
            {status.label}
          </Badge>
        </div>
        <CardDescription className="text-xs">{connector.blurb}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="min-w-0 rounded-md border bg-muted/40 p-2 text-[11px] leading-snug">
          <p className="break-words font-medium">{status.reason}</p>
          <p className="break-words text-muted-foreground">Next: {status.fix}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          {connector.capabilities.map((cap) => (
            <Badge key={cap} variant="secondary" className="px-1.5 py-0 text-[10px] capitalize">
              {cap}
            </Badge>
          ))}
          {connector.unsupported?.map((cap) => (
            <Badge
              key={cap}
              variant="outline"
              className="px-1.5 py-0 text-[10px] capitalize text-muted-foreground line-through"
            >
              {cap}
            </Badge>
          ))}
        </div>

        {accounts.map((a) => (
          <div key={a.id} className="min-w-0 rounded-md border p-2 text-xs">
            <p className="truncate font-medium">{a.label}</p>
            <p className="text-muted-foreground">
              {a.last_synced_at
                ? `Synced ${new Date(a.last_synced_at).toLocaleString()}`
                : "Never synced"}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                className="h-7 gap-1 px-2 text-xs"
                disabled={busyId === a.id}
                onClick={() => onScan(a.id)}
              >
                <Sparkles className="size-3" /> Flas scan
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => onOptimize(a.id)}
              >
                Optimize profile
              </Button>
              {a.profile_url && (
                <Button asChild size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs">
                  <a href={a.profile_url} target="_blank" rel="noreferrer noopener">
                    <ExternalLink className="size-3" /> Open
                  </a>
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2 text-xs text-destructive"
                onClick={() => onDisconnect(a.id)}
              >
                <Unplug className="size-3" /> Disconnect
              </Button>
            </div>
          </div>
        ))}

        {/* Short summary only — the full step-by-step lives in the wizard so the
            cards stay the same size and nothing overflows. */}
        {guide ? (
          <p className="line-clamp-2 min-w-0 break-words text-[11px] text-muted-foreground">
            {guide.requires[0]}
          </p>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2">
          {connector.internalHref ? (
            <Button asChild size="sm" className="h-8 gap-1 text-xs">
              <Link to={connector.internalHref}>
                Set up in Flas <ArrowUpRight className="size-3" />
              </Link>
            </Button>
          ) : connector.oauth ? (
            !ready && onAddKeys ? (
              // Without app keys the platform refuses the login window, so we
              // send the user to the one step that unblocks it.
              <Button size="sm" className="h-8 gap-1 text-xs" onClick={onAddKeys}>
                <KeyRound className="size-3" /> Add app keys
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-8 text-xs"
                variant={connected ? "outline" : "default"}
                disabled={connecting}
                onClick={onConnect}
              >
                {connected ? "Connect another" : "Connect"}
              </Button>
            )
          ) : (
            <Badge variant="outline" className="text-[10px]">
              Manual setup
            </Badge>
          )}
          <Button
            size="sm"
            variant="secondary"
            className="h-8 gap-1 text-xs"
            onClick={() => setWizardOpen(true)}
          >
            <Wand2 className="size-3" /> Setup guide
          </Button>
          <Button asChild size="sm" variant="ghost" className="h-8 gap-1 text-xs">
            <a href={connector.manageUrl} target="_blank" rel="noreferrer noopener">
              Platform settings <ExternalLink className="size-3" />
            </a>
          </Button>
        </div>

        <ConnectionWizard
          platformId={connector.id}
          status={status}
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          connecting={connecting}
          onConnect={onConnect}
        />
      </CardContent>
    </Card>
  );
}
