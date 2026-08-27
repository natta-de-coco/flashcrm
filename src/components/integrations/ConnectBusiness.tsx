import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CONNECTORS, type Connector, type ConnectorGroup } from "@/lib/connections-catalog";
import { ConnectionWizard } from "@/components/integrations/ConnectionWizard";
import { OAUTH_REDIRECT_PATH, setupGuide } from "@/lib/connection-setup";
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
    blurb: "Publish posts, pull reach and answer DMs and comments inside Flash.",
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
    blurb: "Read spend and results so Flash can advise on what to scale.",
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
 * The single place where every Flash integration is connected, grouped by what
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
      toast.success(`Flash scan complete — profile score ${r.overall}/100`);
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

  return (
    <section id="platforms" className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Platform connections</h2>
          <p className="text-sm text-muted-foreground">
            Connect once — Flash then reads your data and works inside these accounts. Nothing is
            posted without your approval.
          </p>
        </div>
        <Badge variant="secondary" className="gap-1.5">
          <Link2 className="size-3.5" /> {connectedCount} connected
        </Badge>
      </div>

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
                  ready={data?.providerReady?.[c.provider ?? ""]?.ready ?? false}
                  connecting={connect.isPending && connect.variables === c.id}
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
            <CardTitle className="text-base">Flash profile suggestions</CardTitle>
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
  ready,
  connecting,
  busyId,
  onConnect,
  onScan,
  onOptimize,
  onDisconnect,
}: {
  connector: Connector;
  accounts: Account[];
  ready: boolean;
  connecting: boolean;
  busyId: string | null;
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
  return (
    <Card className={status.state === "connected" ? "border-primary/40" : undefined}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-semibold">{connector.name}</CardTitle>
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
            className="gap-1 whitespace-nowrap"
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
      <CardContent className="grid gap-2">
        <div className="rounded-md border bg-muted/40 p-2 text-[11px] leading-snug">
          <p className="font-medium">{status.reason}</p>
          <p className="text-muted-foreground">Next: {status.fix}</p>
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
          <div key={a.id} className="rounded-md border p-2 text-xs">
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
                <Sparkles className="size-3" /> Flash scan
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

        <ConnectorGuide id={connector.id} />

        <div className="flex flex-wrap items-center gap-1.5">
          {connector.internalHref ? (
            <Button asChild size="sm" className="h-8 gap-1 text-xs">
              <Link to={connector.internalHref}>
                Set up in Flash <ArrowUpRight className="size-3" />
              </Link>
            </Button>
          ) : connector.oauth ? (
            <Button
              size="sm"
              className="h-8 text-xs"
              variant={connected ? "outline" : "default"}
              disabled={connecting}
              onClick={onConnect}
            >
              {connected ? "Connect another" : ready ? "Connect securely" : "Connect"}
            </Button>
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
            <Wand2 className="size-3" /> Setup wizard
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

/**
 * Plain-language, per-platform setup detail: what you must own, the exact
 * steps, the permissions Flash asks for, and the traps that usually block a
 * connection (Meta iframe blocks, unverified locations, review-gated APIs).
 */
function ConnectorGuide({ id }: { id: string }) {
  const guide = setupGuide(id);
  if (!guide) return null;
  return (
    <details className="rounded-md border bg-muted/40 p-2 text-xs">
      <summary className="cursor-pointer list-none font-medium">
        How to connect this — step by step
      </summary>
      <div className="mt-2 grid gap-2">
        <div>
          <p className="font-semibold">You need</p>
          <ul className="ml-4 list-disc text-muted-foreground">
            {guide.requires.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="font-semibold">Steps</p>
          <ol className="ml-4 list-decimal text-muted-foreground">
            {guide.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
        {guide.scopes && guide.scopes.length > 0 && (
          <div>
            <p className="font-semibold">Permissions Flash requests</p>
            <p className="break-words font-mono text-[10px] text-muted-foreground">
              {guide.scopes.join(" · ")}
            </p>
          </div>
        )}
        {guide.gotchas && guide.gotchas.length > 0 && (
          <div>
            <p className="font-semibold">Good to know</p>
            <ul className="ml-4 list-disc text-muted-foreground">
              {guide.gotchas.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-muted-foreground">
          Redirect URI to whitelist in the provider app:{" "}
          <span className="font-mono">https://flas.mobidigisol.com{OAUTH_REDIRECT_PATH}</span>
        </p>
      </div>
    </details>
  );
}
