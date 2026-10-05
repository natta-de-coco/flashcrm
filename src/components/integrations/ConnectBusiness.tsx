import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CONNECTORS, type Connector, type ConnectorGroup } from "@/lib/connections-catalog";
import {
  CAPABILITY_LABELS,
  STATUS_LABELS,
  advertisableCapabilities,
  connectorDefinition,
  implementsAnything,
  resolveAllCapabilities,
} from "@/lib/social-connector-definitions";
import { ConnectionWizard } from "@/components/integrations/ConnectionWizard";
import { HealthReportDialog } from "@/components/integrations/HealthReportDialog";
import { connectorIcon } from "@/components/integrations/connector-icons";
import { credentialSpec, setupGuide } from "@/lib/connection-setup";
import { connectionStatus } from "@/lib/connection-status";
import {
  disconnectConnection,
  getConnections,
  optimizeConnectedProfile,
  scanConnectedAccount,
  getConnectReadiness,
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
  KeyRound,
  Search,
  Unplug,
  Wand2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/hooks/useI18n";
import { hasMessage, type MessageKey } from "@/lib/i18n";

const GROUPS: {
  id: ConnectorGroup;
  title: string;
  blurb: string;
  icon: typeof Megaphone;
}[] = [
  {
    id: "social",
    title: "Social profiles",
    blurb:
      "Pull posts, reach and comments into Flas and reply where the platform allows. Each card shows what works today.",
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
    blurb:
      "Meta Ads spend and results for the last 28 days. Other ad platforms are not available yet.",
    icon: BarChart3,
  },
  {
    id: "analytics",
    title: "Analytics & search",
    blurb: "GA4 traffic and Search Console search performance for the last 28 days.",
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
  const { t, tr } = useI18n();
  const qc = useQueryClient();
  const connections = useQuery({ queryKey: ["connections"], queryFn: () => getConnections() });
  // Which platforms can actually be authorized right now. Without this the
  // only way to find out was to click Connect and read a toast that vanished.
  const readiness = useQuery({
    queryKey: ["connect-readiness"],
    queryFn: () => getConnectReadiness(),
  });
  const readyById = new Map((readiness.data ?? []).map((r) => [r.id as string, r]));
  const start = useServerFn(startConnect);
  const scan = useServerFn(scanConnectedAccount);
  const optimize = useServerFn(optimizeConnectedProfile);
  const disconnect = useServerFn(disconnectConnection);
  const [blocked, setBlocked] = useState<{ reason: string; missing: string[] } | null>(null);
  // Keyed by connector id: a failed Connect belongs on the card the user
  // pressed, not in a banner at the top of a nineteen-card grid.
  const [connectErrors, setConnectErrors] = useState<
    Record<string, { reason: string; missing: string[] }>
  >({});
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [onlyConnected, setOnlyConnected] = useState(false);
  const [optimizerFor, setOptimizerFor] = useState<string | null>(null);
  const [optimizerText, setOptimizerText] = useState<string>("");

  // Name, blurb and category all match, so "inbox" or "ads" finds the right
  // card without knowing the vendor's name.
  const visible = CONNECTORS.filter((c) => {
    if (onlyConnected && !accountsFor(c.id).some((a) => a.active)) return false;
    if (!onlyConnected && category !== "all" && c.group !== category) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      c.blurb.toLowerCase().includes(q) ||
      c.group.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q)
    );
  });

  const connect = useMutation({
    mutationFn: async (platform: string) => {
      setConnectErrors((prev) => {
        const next = { ...prev };
        delete next[platform];
        return next;
      });
      return start({ data: { platform: platform as never, origin: window.location.origin } });
    },
    onSuccess: (result) => {
      if (result.ready) {
        // Providers like Facebook/Google refuse to render inside an iframe
        // (ERR_BLOCKED_BY_RESPONSE), so always hand off to a real browser tab.
        const opened = window.open(result.url, "_blank", "noopener,noreferrer");
        if (!opened) {
          toast.error(t("connectBusiness.allowPopUpsThenClick"));
          return;
        }
        toast.info(t("connectBusiness.finishSigningInOnThe"));
        return;
      }
      // A toast disappears; this is setup information the user needs while
      // they go and fix it, so it stays until dismissed.
      const detail = { reason: result.reason, missing: result.missing ?? [] };
      setBlocked(detail);
      setConnectErrors((prev) => ({ ...prev, [connect.variables as string]: detail }));
      toast.info(result.reason);
    },

    onError: (e: Error, platform) => {
      setConnectErrors((prev) => ({
        ...prev,
        [platform]: { reason: e.message, missing: [] },
      }));
      toast.error(e.message);
    },
  });

  const runScan = useMutation({
    mutationFn: async (id: string) => scan({ data: { id } }),
    onSuccess: (r: { overall: number }) => {
      toast.success(t("connectBusiness.flasScanCompleteProfileScore", { overall: r.overall }));
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
      toast.success(t("connectBusiness.disconnectedHistoryKept"));
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
          <h2 className="text-lg font-semibold">{t("connectBusiness.platformConnections")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("connectBusiness.connectOnceFlasThenReads")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1.5">
            <Link2 className="size-3.5" />{" "}
            {tr("connectBusiness.connected", { connectedCount: connectedCount })}
          </Badge>
          <HealthReportDialog />
        </div>
      </div>

      {blocked && (
        <Alert>
          <KeyRound className="size-4" />
          <AlertTitle>{t("connectBusiness.oneTimeSetupNeededBefore")}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{blocked.reason}</p>
            {blocked.missing.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium">{t("connectBusiness.missing")}</p>
                <ul className="flex flex-wrap gap-1.5">
                  {blocked.missing.map((k) => (
                    <li key={k}>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{k}</code>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Button size="sm" variant="outline" onClick={() => setBlocked(null)}>
              {t("connectBusiness.dismiss")}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {connections.isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      )}

      {/* One browser instead of five stacked lists. With nineteen connectors
          across five groups, scrolling was the only way to find anything and
          the eye had to re-anchor at every section heading. */}
      {!connections.isLoading && (
        <div className="grid gap-4 lg:grid-cols-[13rem_1fr]">
          <aside className="grid h-max gap-1 lg:sticky lg:top-4">
            <div className="relative mb-2">
              <Search className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("connectBusiness.searchConnectors")}
                className="h-9 ps-8 text-sm"
                aria-label={t("connectBusiness.searchConnectors")}
              />
            </div>

            <RailButton
              label={t("connectBusiness.connected2")}
              count={connectedCount}
              active={onlyConnected}
              onClick={() => {
                setOnlyConnected(true);
                setCategory("all");
              }}
            />
            <RailButton
              label={t("connectBusiness.all")}
              count={CONNECTORS.length}
              active={!onlyConnected && category === "all"}
              onClick={() => {
                setOnlyConnected(false);
                setCategory("all");
              }}
            />

            <p className="mt-3 px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("connectBusiness.categories")}
            </p>
            {GROUPS.map((g) => (
              <RailButton
                key={g.id}
                label={
                  hasMessage(`connectBusiness.group.${g.id}`)
                    ? t(`connectBusiness.group.${g.id}` as MessageKey)
                    : g.title
                }
                count={CONNECTORS.filter((c) => c.group === g.id).length}
                active={!onlyConnected && category === g.id}
                onClick={() => {
                  setOnlyConnected(false);
                  setCategory(g.id);
                }}
              />
            ))}
          </aside>

          <div className="min-w-0">
            {visible.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <p className="text-sm font-medium">{t("connectBusiness.noConnectorMatchesThat")}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {tr("connectBusiness.tryADifferentWordOr", { length: CONNECTORS.length })}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => {
                    setQuery("");
                    setCategory("all");
                    setOnlyConnected(false);
                  }}
                >
                  {t("connectBusiness.clearFilters")}
                </Button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {visible.map((c) => (
                  <ConnectorCard
                    key={c.id}
                    connector={c}
                    accounts={accountsFor(c.id)}
                    readiness={readyById.get(c.id) ?? null}
                    error={connectErrors[c.id] ?? null}
                    connecting={connect.isPending && connect.variables === c.id}
                    onConnect={() => connect.mutate(c.id)}
                    onScan={(id) => runScan.mutate(id)}
                    onOptimize={(id) => runOptimize.mutate(id)}
                    onDisconnect={(id) => remove.mutate(id)}
                    busyId={runScan.isPending ? (runScan.variables as string) : null}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {optimizerFor && optimizerText && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("connectBusiness.flasProfileSuggestions")}
            </CardTitle>
            <CardDescription>{t("connectBusiness.copyTheseIntoThePlatform")}</CardDescription>
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
              {t("connectBusiness.close")}
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
  readiness,
  error,
  connecting,
  busyId,
  onConnect,
  onScan,
  onOptimize,
  onDisconnect,
}: {
  connector: Connector;
  /** null while loading, or for connectors with no OAuth flow. */
  readiness: { ready: boolean; missing: string[]; source: string } | null;
  /** Why the last Connect on THIS card failed, shown in place of the status. */
  error: { reason: string; missing: string[] } | null;
  accounts: Account[];
  connecting: boolean;
  busyId: string | null;
  onConnect: () => void;
  onScan: (id: string) => void;
  onOptimize: (id: string) => void;
  onDisconnect: (id: string) => void;
}) {
  const { t, tr } = useI18n();
  const connected = accounts.some((a) => a.active);
  const definition = connectorDefinition(connector.id);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<"prepare" | "credentials">("prepare");
  const needsKeys = Boolean(connector.oauth && readiness && !readiness.ready);
  // Whether the wizard has fields to collect for this channel.
  const hasGuidedSetup = Boolean(
    credentialSpec(connector.id, { provider: connector.provider ?? null }),
  );
  // One clear state per card: Connected / Needs verification / Pending review /
  // Expired / Failing, always with the precise reason and the next action.
  const status = connectionStatus(accounts[0]);
  const guide = setupGuide(connector.id);
  const { icon: Icon, tint } = connectorIcon(connector.id);
  return (
    <Card
      className={`flex h-full min-w-0 flex-col ${
        status.state === "connected" ? "border-primary/40" : ""
      }`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          {/* Icon first, so the eye finds a platform by shape rather than by
              reading nineteen names. Fixed 8x8 box keeps every title on the
              same baseline whatever the icon. */}
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/40">
              <Icon className={`size-4 ${tint}`} />
            </span>
            <CardTitle className="min-w-0 break-words text-sm font-semibold">
              {connector.name}
            </CardTitle>
          </div>
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
        {error ? (
          <div className="min-w-0 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-[11px] leading-snug">
            <p className="break-words font-medium text-destructive">
              {t("connectBusiness.couldnTConnect")}
            </p>
            <p className="break-words">{error.reason}</p>
            {error.missing.length > 0 && (
              <p className="mt-1 break-words text-muted-foreground">
                {tr("connectBusiness.missing2", { join: error.missing.join(", ") })}
              </p>
            )}
          </div>
        ) : (
          <div className="min-w-0 rounded-md border bg-muted/40 p-2 text-[11px] leading-snug">
            <p className="break-words font-medium">{status.reason}</p>
            <p className="break-words text-muted-foreground">
              {tr("connectBusiness.next", { fix: status.fix })}
            </p>
          </div>
        )}
        {/* Capability badges come from the connector registry, never from a
            list kept on the card. The old list used one broad "messaging"
            label covering comments, reviews and DMs at once, and claimed
            "publish" for nine platforms Flas has no publish code for.

            Only genuinely usable capabilities get a solid badge. Everything
            else is shown with its real status rather than hidden, so the card
            distinguishes "we have not built it" from "the provider has no
            such API" -- and never shows either as available. */}
        {/* A connector Flas has built nothing for renders no badges at all,
            and an empty row reads as "no information" rather than "this does
            nothing". Threads, Google Ads, LinkedIn Ads and GA4 are all in that
            state: they authorise, store a token, and deliver no feature. Say
            so before someone spends an afternoon on the OAuth setup.

            Deliberately not keyed on advertisableCapabilities being empty:
            that requires the status "implemented", which WhatsApp, Instagram
            and YouTube do not reach until the provider approves the app, and
            flagging those would be plainly wrong. */}
        {definition && !implementsAnything(definition) && (
          <p className="min-w-0 rounded-md border border-dashed p-2 text-[11px] leading-snug text-muted-foreground">
            {tr("connectBusiness.flasCanAuthoriseButNo", {
              span: (
                <span className="font-medium text-foreground">
                  {t("connectBusiness.nothingToUseYet")}
                </span>
              ),
              name: connector.name,
            })}
          </p>
        )}
        <div className="flex flex-wrap gap-1">
          {definition &&
            advertisableCapabilities(definition).map((cap) => (
              <Badge key={cap.key} variant="secondary" className="px-1.5 py-0 text-[10px]">
                {CAPABILITY_LABELS[cap.key]}
              </Badge>
            ))}
          {definition &&
            resolveAllCapabilities(definition)
              .filter(
                (cap) =>
                  cap.status === "requires_provider_review" ||
                  cap.status === "limited_by_account_type",
              )
              .map((cap) => (
                <Badge
                  key={cap.key}
                  variant="outline"
                  className="px-1.5 py-0 text-[10px]"
                  title={cap.note ?? STATUS_LABELS[cap.status]}
                >
                  {CAPABILITY_LABELS[cap.key]} · {STATUS_LABELS[cap.status].toLowerCase()}
                </Badge>
              ))}
        </div>

        {accounts.map((a) => (
          <div key={a.id} className="min-w-0 rounded-md border p-2 text-xs">
            <p className="truncate font-medium">{a.label}</p>
            <p className="text-muted-foreground">
              {a.last_synced_at
                ? t("connectBusiness.synced", {
                    toLocaleString: new Date(a.last_synced_at).toLocaleString(),
                  })
                : t("connectBusiness.neverSynced")}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                className="h-7 gap-1 px-2 text-xs"
                disabled={busyId === a.id}
                onClick={() => onScan(a.id)}
              >
                <Sparkles className="size-3" /> {t("connectBusiness.flasScan")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 px-2 text-xs"
                onClick={() => onOptimize(a.id)}
              >
                {t("connectBusiness.optimizeProfile")}
              </Button>
              {a.profile_url && (
                <Button asChild size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs">
                  <a href={a.profile_url} target="_blank" rel="noreferrer noopener">
                    <ExternalLink className="size-3" /> {t("connectBusiness.open")}
                  </a>
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2 text-xs text-destructive"
                onClick={() => onDisconnect(a.id)}
              >
                <Unplug className="size-3" /> {t("connectBusiness.disconnect")}
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
        {connector.unavailableReason ? (
          <p className="line-clamp-3 min-w-0 break-words text-[11px] text-muted-foreground">
            {connector.unavailableReason}
          </p>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2">
          {connector.internalHref ? (
            <Button asChild size="sm" className="h-8 gap-1 text-xs">
              <Link to={connector.internalHref}>
                {t("connectBusiness.setUpInFlas")} <ArrowUpRight className="size-3" />
              </Link>
            </Button>
          ) : connector.unavailableReason ? (
            <Badge variant="outline" className="text-[10px]">
              {t("connectBusiness.notAvailableYet")}
            </Badge>
          ) : connector.oauth ? (
            // Readiness is known before the click. When the keys are missing,
            // the button that does something useful is "Add app keys" -- not a
            // Connect that is guaranteed to fail next to a badge explaining
            // why. It opens the wizard on the key form itself.
            needsKeys ? (
              <Button
                size="sm"
                className="h-8 gap-1 text-xs"
                onClick={() => {
                  setWizardStep("credentials");
                  setWizardOpen(true);
                }}
              >
                <KeyRound className="size-3" /> {t("connectBusiness.addAppKeys")}
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-8 text-xs"
                variant={connected ? "outline" : "default"}
                disabled={connecting}
                onClick={onConnect}
              >
                {connecting
                  ? t("connectBusiness.opening")
                  : connected
                    ? t("connectBusiness.connectAnother")
                    : t("connectBusiness.connect")}
              </Button>
            )
          ) : hasGuidedSetup ? (
            // Channels without an OAuth flow are still set up the same way:
            // one guided wizard that collects what it needs in place. Showing
            // a bare "Manual setup" badge told the user nothing and offered
            // them nothing to press.
            <Button size="sm" className="h-8 text-xs" onClick={() => setWizardOpen(true)}>
              {connected ? t("connectBusiness.addAnother") : t("connectBusiness.setUp")}
            </Button>
          ) : (
            <Badge variant="outline" className="text-[10px]">
              {t("connectBusiness.manualSetup")}
            </Badge>
          )}
          <Button
            size="sm"
            variant="secondary"
            className="h-8 gap-1 text-xs"
            onClick={() => setWizardOpen(true)}
          >
            <Wand2 className="size-3" /> {t("connectBusiness.setupGuide")}
          </Button>
          <Button asChild size="sm" variant="ghost" className="h-8 gap-1 text-xs">
            <a href={connector.manageUrl} target="_blank" rel="noreferrer noopener">
              {t("connectBusiness.platformSettings")} <ExternalLink className="size-3" />
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

/** A row in the category rail: label left, count right, selected state clear. */
function RailButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition ${
        active ? "bg-muted font-medium" : "hover:bg-muted/60"
      }`}
    >
      <span className="truncate">{label}</span>
      <span className="ms-2 shrink-0 text-xs tabular-nums text-muted-foreground">{count}</span>
    </button>
  );
}
