import { HealthReportDialog } from "@/components/integrations/HealthReportDialog";
import { IntegrationLogs } from "@/components/integrations/IntegrationLogs";
import { IntegrationSettings } from "@/components/integrations/IntegrationSettings";
import {
  ConnectionOutcome,
  type ConnectionOutcomeSearch,
} from "@/components/integrations/ConnectionOutcome";
import {
  connectorDefinition,
  resolveAllCapabilities,
  CAPABILITY_LABELS,
} from "@/lib/social-connector-definitions";
import { PageHeader } from "@/components/PageHeader";
import { AiKeysCard } from "@/components/integrations/AiKeysCard";
import { CredentialsStep } from "@/components/integrations/CredentialsStep";
import { connectorIcon } from "@/components/integrations/connector-icons";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { CONNECTORS, type Connector, type ConnectorGroup } from "@/lib/connections-catalog";
import { credentialSpec, OAUTH_REDIRECT_PATH } from "@/lib/connection-setup";
import { actionableBlockers, continueTarget } from "@/lib/credential-handoff";
import {
  accountIdLabel,
  connectSteps,
  handoffNote,
  pickerNoun,
  plainPermissions,
} from "@/lib/connect-consent";
import type { ReadinessBlocker } from "@/lib/integration-readiness.functions";
import { connectionStatus } from "@/lib/connection-status";
import {
  connectedChannelCount,
  identifiedAccounts,
  pendingConnectionPrompts,
} from "@/lib/integration-counts";
import { plainErrorMessage } from "@/lib/plain-error";
import {
  disconnectConnection,
  getConnections,
  getIntegrationHealthReport,
  startConnect,
} from "@/lib/connections.functions";
import {
  getIntegrationReadiness,
  type IntegrationReadinessRow,
} from "@/lib/integration-readiness.functions";
import { providerSetup } from "@/lib/provider-setup-links";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  KeyRound,
  Link2,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Stethoscope,
  Unplug,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/hooks/useI18n";
import { hasMessage, type MessageKey } from "@/lib/i18n";

type Translate = ReturnType<typeof useI18n>["t"];

type Account = {
  id: string;
  platform: string;
  label: string;
  active: boolean;
  external_id: string | null;
  granted_scopes?: string[] | null;
  renews?: boolean;
  health: string;
  last_synced_at: string | null;
  token_expires_at: string | null;
  permissions: string[] | null;
  profile_url: string | null;
  connect_method: string;
  created_at?: string | null;
};

/** A WhatsApp number as the browser may read it: never its token or secret. */
type WaNumber = {
  id: string;
  label: string;
  active: boolean;
  phone_number_id: string;
  display_phone: string | null;
  is_default: boolean;
  created_at: string | null;
};

const GROUP_LABELS: Record<ConnectorGroup, string> = {
  social: "Social",
  messaging: "Messaging",
  ads: "Advertising",
  analytics: "Analytics",
  commerce: "Website & Commerce",
};

/** The problem panel shown after a connection could not be started. */
type BlockedPanel = {
  platform: string;
  message: string;
  /** Nothing for this person to do: FLAS itself is finishing setup. */
  calm?: boolean;
  /**
   * What still blocks this connection, read from the server after the refusal.
   * Empty until that answer arrives, and if it never does: the readiness rows
   * on screen can be from before the admin saved the details, and naming them
   * as missing would be wrong. Absent for a panel that was not the result of
   * a refusal; those read the rows on screen.
   */
  blockers?: ReadinessBlocker[];
};

/** The channels a company thinks of as "my channels", each with its own page. */
const CHANNELS = ["whatsapp", "facebook", "instagram"];

const POPULAR = new Set([
  "facebook",
  "instagram",
  "youtube",
  "whatsapp",
  "linkedin",
  "google_business",
]);

function friendlyCapability(platform: string): string[] {
  const definition = connectorDefinition(platform);
  return (
    definition
      ? resolveAllCapabilities(definition)
          .filter((c) =>
            ["implemented", "requires_provider_review", "limited_by_account_type"].includes(
              c.status,
            ),
          )
          .map((c) => c.key)
      : []
  )
    .filter((key) => key !== "webhooks")
    .map((key) => CAPABILITY_LABELS[key]);
}

function humanTime(value: string | null) {
  if (!value) return "Not yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not yet" : date.toLocaleString();
}

function signInLabel(provider: string | null | undefined, name: string) {
  return `Continue with ${provider === "meta" ? "Facebook" : provider === "google" ? "Google" : name}`;
}

export function IntegrationsAuditFixed({
  search = {},
  onDismiss = () => {},
}: {
  search?: ConnectionOutcomeSearch;
  onDismiss?: () => void;
}) {
  const { t, tr } = useI18n();
  // Company owners are admins of their workspace, not of FLAS: they get
  // Continue with Facebook, never FLAS's server diagnostics. Those are for
  // FLAS staff (super admins) only.
  const { isAdmin, isSuperAdmin } = useAuth();
  const qc = useQueryClient();
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const connections = useQuery({ queryKey: ["connections"], queryFn: () => getConnections() });
  const readiness = useQuery({
    queryKey: ["integration-readiness", origin],
    enabled: Boolean(origin),
    queryFn: () => getIntegrationReadiness({ data: { origin } }),
  });
  const start = useServerFn(startConnect);
  const disconnect = useServerFn(disconnectConnection);
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);
  const [providerSetupOpen, setProviderSetupOpen] = useState(false);
  // Which connector sent the admin to setup, so saving an app continues with
  // that product rather than whichever row the credentials were typed into.
  const [setupReturnTo, setSetupReturnTo] = useState<string | null>(null);
  const [credentialsFor, setCredentialsFor] = useState<string | null>(null);
  // Nobody is sent to a provider's consent screen without being told, in plain
  // words, what FLAS is about to ask for and what they will choose there.
  const [confirming, setConfirming] = useState<string | null>(null);
  // One channel at a time: its own steps, its own state, its own buttons.
  const [channel, setChannel] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"popular" | ConnectorGroup>("popular");
  const [connecting, setConnecting] = useState<string | null>(null);
  const starting = useRef(false);
  const [blocked, setBlocked] = useState<BlockedPanel | null>(null);

  const allAccounts = (connections.data?.accounts ?? []) as Account[];
  const waNumbers = (
    (connections.data as { whatsappNumbers?: WaNumber[] } | undefined)?.whatsappNumbers ?? []
  ).filter((n) => n.active);
  const accounts = identifiedAccounts(allAccounts);
  // M1: a platform that is already connected is not asked to "finish
  // connecting". An abandoned second sign-in leaves an unidentified row behind
  // for ever, and that row kept the banner on screen beside the very account it
  // was asking for.
  const pendingAccounts = pendingConnectionPrompts(allAccounts);
  const [resume, setResume] = useState<ConnectionOutcomeSearch | null>(null);
  const rows = readiness.data?.rows ?? [];
  const readinessMap = new Map(rows.map((r) => [r.id, r]));
  const attention = accounts.filter((a) => {
    const state = connectionStatus(a);
    return state.tone === "bad" || state.tone === "warn";
  });
  const available = rows.filter((r) => r.status === "READY" || r.status === "LIMITED").length;
  const comingSoon = rows.filter((r) => r.status === "COMING_SOON").length;
  // M2: until each query has answered, its tiles show a skeleton. They used to
  // render 0/0/0/0 — readiness is not even enabled until the effect above sets
  // the origin — and then jumped to 2/0/8/7, so the first thing the page said
  // about a working workspace was that nothing was connected.
  const connectionsPending = connections.isPending;
  const readinessPending = !readiness.data && !readiness.isError;
  // M4: WhatsApp numbers live in wa_numbers, not social_accounts, so the tile
  // counted 2 while WhatsApp's own panel said Connected.
  const connectedTotal = connectedChannelCount({
    accounts: allAccounts,
    whatsappNumbers: waNumbers,
  });

  // M3: the Health report dialog has no error state of its own, so a failed
  // report left an empty panel, no toast and nothing to act on. This observer
  // never fetches (enabled: false) — it watches the cache the dialog fills, so
  // when that fetch fails the page itself says what happened.
  const healthReportFn = useServerFn(getIntegrationHealthReport);
  const healthReport = useQuery({
    queryKey: ["integration-health"],
    queryFn: () => healthReportFn(),
    enabled: false,
  });

  const marketplaceItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CONNECTORS.filter((c) => {
      if (category === "popular" && !POPULAR.has(c.id)) return false;
      if (category !== "popular" && c.group !== category) return false;
      return !q || `${c.name} ${c.blurb} ${GROUP_LABELS[c.group]}`.toLowerCase().includes(q);
    });
  }, [category, query]);

  /**
   * After a refusal, asks the server what is still blocking this connection and
   * waits for the answer. The old way was to mark the readiness data stale and
   * go on: the panel then listed whatever the rows on screen said, which for an
   * admin who had just saved the missing app details was the list from before
   * they saved — until the refetch landed, and for good if it failed.
   *
   * The answer goes only to the panel this refusal put on screen. If the person
   * has closed it since, or another refusal has replaced it, it is for something
   * nobody is looking at: it must not bring a closed panel back, or put one
   * connection's blockers on another's.
   */
  async function showWhatStillBlocks(panel: BlockedPanel) {
    let blockers: ReadinessBlocker[] = [];
    try {
      const fresh = await qc.fetchQuery({
        queryKey: ["integration-readiness", window.location.origin],
        queryFn: () => getIntegrationReadiness({ data: { origin: window.location.origin } }),
        staleTime: 0,
      });
      blockers = actionableBlockers(fresh.rows.find((r) => r.id === panel.platform));
    } catch {
      // Not re-read: say less rather than say what may no longer be true.
    }
    setBlocked((current) => (current === panel ? { ...panel, blockers } : current));
  }

  const connect = useMutation({
    mutationFn: async (platform: string) => {
      setBlocked(null);
      setConnecting(platform);
      return start({ data: { platform: platform as never, origin: window.location.origin } });
    },
    onSuccess: (result, platform) => {
      starting.current = false;
      setConnecting(null);
      if (!result.ready) {
        const panel: BlockedPanel = isSuperAdmin
          ? {
              platform,
              message:
                "This connection is temporarily unavailable while administrator setup is completed.",
              blockers: [],
            }
          : { platform, calm: true, message: notYetMessage(platformName(platform)) };
        setBlocked(panel);
        void showWhatStillBlocks(panel);
        return;
      }
      window.location.assign(result.url);
    },
    onError: (_e: Error, platform) => {
      starting.current = false;
      setConnecting(null);
      const panel: BlockedPanel = {
        platform,
        message: "The connection could not start. Please try again in a moment.",
        blockers: [],
      };
      setBlocked(panel);
      void showWhatStillBlocks(panel);
    },
  });

  /** The manual WhatsApp route: the number form in Advanced admin settings. */
  function openWhatsAppNumberSetup() {
    setChannel(null);
    if (typeof document === "undefined") return;
    const details = document.getElementById("channel-setup");
    if (details instanceof HTMLDetailsElement) details.open = true;
    window.setTimeout(
      () =>
        document.getElementById("whatsapp")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      150,
    );
  }

  function openDiagnostics(returnTo: string | null) {
    setSetupReturnTo(returnTo);
    // Two dialogs stacked on top of each other otherwise.
    setMarketplaceOpen(false);
    setChannel(null);
    setProviderSetupOpen(true);
  }

  function beginConnect(platform: string) {
    if (starting.current || connect.isPending) return;
    starting.current = true;
    setChannel(null);
    setSetupReturnTo(null);
    setCredentialsFor(null);
    setConfirming(null);
    setProviderSetupOpen(false);
    setMarketplaceOpen(false);
    // startConnect rechecks all prerequisites server-side. Do not rely on
    // readiness cached before the workspace app was saved.
    connect.mutate(platform);
  }

  const remove = useMutation({
    mutationFn: async (id: string) => disconnect({ data: { id } }),
    onSuccess: () => {
      toast.success(t("integrationsAuditFixed.disconnectedExistingFlasHistoryIs"));
      void qc.invalidateQueries({ queryKey: ["connections"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function chooseCategory(next: "popular" | ConnectorGroup) {
    setCategory(next);
    setQuery("");
    setBlocked(null);
  }

  function openConnector(connector: Connector) {
    setBlocked(null);
    const row = readinessMap.get(connector.id);
    if (!row) return;
    if (row.status === "ADMIN_SETUP_REQUIRED") {
      if (isSuperAdmin && (connector.oauth || connector.id === "whatsapp")) {
        openDiagnostics(connector.id);
      } else if (row.setupOwner === "workspace") {
        setBlocked({
          platform: connector.id,
          message: isAdmin
            ? (row.blockers.find((b) => b.severity === "BLOCKING")?.userMessage ??
              `${connector.name} needs one more step from your workspace.`)
            : `Ask your workspace admin to finish setting up ${connector.name}.`,
        });
      } else {
        setBlocked({ platform: connector.id, calm: true, message: notYetMessage(connector.name) });
      }
      return;
    }
    if (row?.status === "COMING_SOON") return;
    if (connector.oauth) {
      setConfirming(connector.id);
      return;
    }
    if (connector.internalHref && connector.internalHref !== "/connect") {
      window.location.href = connector.internalHref;
      return;
    }
    toast.info(t("integrationsAuditFixed.setupIsManagedFromThis", { name: connector.name }));
  }

  const confirmConnector = confirming ? CONNECTORS.find((c) => c.id === confirming) : undefined;
  const channelConnector = channel ? CONNECTORS.find((c) => c.id === channel) : undefined;
  const credentialConnector = credentialsFor
    ? CONNECTORS.find((c) => c.id === credentialsFor)
    : undefined;
  const credentialSiblings = credentialConnector?.provider
    ? CONNECTORS.filter(
        (c) => c.provider === credentialConnector.provider && c.id !== credentialConnector.id,
      ).map((c) => c.name)
    : [];
  const spec = credentialConnector
    ? credentialSpec(credentialConnector.id, {
        provider: credentialConnector.provider ?? null,
        siblings: credentialSiblings,
      })
    : undefined;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <PageHeader
            title={t("integrationsAuditFixed.integrations")}
            description={t("integrationsAuditFixed.connectTheToolsYourTeam")}
          />
          <div className="flex flex-wrap gap-2">
            {/* Connection health, retries and "Encrypt now" for this company's
                stored credentials. Only the old, unrouted screen opened it, so
                credentials saved before encryption had no way to be sealed. */}
            {isAdmin && (
              <HealthReportDialog
                trigger={
                  <Button variant="outline">
                    <Stethoscope className="me-2 size-4" />{" "}
                    {t("integrationsAuditFixed.healthReport")}
                  </Button>
                }
              />
            )}
            {isSuperAdmin && (
              <Button
                variant="outline"
                onClick={() => {
                  setBlocked(null);
                  openDiagnostics(null);
                }}
              >
                <Settings2 className="me-2 size-4" /> {t("integrationsAuditFixed.adminDiagnostics")}
              </Button>
            )}
            <Button
              onClick={() => {
                setBlocked(null);
                setMarketplaceOpen(true);
              }}
            >
              <Plus className="me-2 size-4" /> {t("integrationsAuditFixed.addIntegration")}
            </Button>
          </div>
        </div>

        {connecting && (
          <p role="status" className="rounded-xl border bg-muted/40 p-4 text-sm">
            {t("integrationsAuditFixed.openingSecureSignInChoose")}
          </p>
        )}
        {/* A page that failed to load is not a connection that needs setup. */}
        {connections.isError && (
          <Problem
            title={t("integrationsAuditFixed.weCouldNotLoadYour")}
            message="Please refresh the page. If it keeps happening, tell your administrator."
            onAdmin={undefined}
          />
        )}
        {readiness.isError && (
          <Problem
            title={t("integrationsAuditFixed.weCouldNotCheckWhich")}
            message="Please refresh the page. If it keeps happening, tell your administrator."
            onAdmin={undefined}
          />
        )}
        {blocked && !marketplaceOpen && (
          <Problem
            message={blocked.message}
            calm={blocked.calm}
            blockers={
              isSuperAdmin
                ? (blocked.blockers ?? actionableBlockers(readinessMap.get(blocked.platform)))
                : []
            }
            // Keep the product that was being connected: if the admin repairs
            // the shared app from a sibling row, saving continues with this one.
            onAdmin={isSuperAdmin ? () => openDiagnostics(blocked.platform) : undefined}
          />
        )}
        <ConnectionOutcome
          search={resume ?? search}
          accounts={allAccounts}
          onChanged={() => {
            void qc.invalidateQueries({ queryKey: ["connections"] });
          }}
          onDismiss={() => {
            setResume(null);
            onDismiss();
          }}
          onRetry={(platform) => {
            onDismiss();
            beginConnect(platform);
          }}
        />
        {pendingAccounts.length > 0 && !search.select_target && !resume && (
          <section className="space-y-3">
            <SectionHeading
              title={t("integrationsAuditFixed.finishConnecting")}
              description={t("integrationsAuditFixed.signInIsSavedChoose")}
            />
            {pendingAccounts.map((account) => (
              <Button
                key={account.id}
                variant="outline"
                onClick={() =>
                  setResume({ connected: account.platform, select_target: account.id })
                }
              >
                {tr("integrationsAuditFixed.choose", {
                  value:
                    CONNECTORS.find((c) => c.id === account.platform)?.name ??
                    t("integrationsAuditFixed.account"),
                })}
              </Button>
            ))}
          </section>
        )}
        {healthReport.isError && (
          <Problem
            title={t("integrationsAuditFixed.weCouldnTBuildYour")}
            message={`${plainErrorMessage(healthReport.error)} Open Health report again to retry.`}
            onAdmin={undefined}
          />
        )}
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label={t("integrationsAuditFixed.connected")}
            value={connectedTotal}
            tone="good"
            loading={connectionsPending}
          />
          <StatCard
            label={t("integrationsAuditFixed.needsAttention")}
            value={attention.length}
            tone={attention.length ? "warn" : "muted"}
            loading={connectionsPending}
          />
          <StatCard
            label={t("integrationsAuditFixed.readyToConnect")}
            value={available}
            tone="muted"
            loading={readinessPending}
          />
          <StatCard
            label={t("integrationsAuditFixed.comingSoon")}
            value={comingSoon}
            tone="muted"
            loading={readinessPending}
          />
        </section>

        {attention.length > 0 && (
          <section className="space-y-3">
            <SectionHeading
              title={t("integrationsAuditFixed.needsAttention")}
              description={t("integrationsAuditFixed.fixTheseFirstSoYour")}
            />
            {attention.map((account) => {
              const state = connectionStatus(account);
              const meta = CONNECTORS.find((c) => c.id === account.platform);
              const { icon: Icon, tint } = connectorIcon(account.platform);
              return (
                <Card key={account.id} className="border-amber-300/60">
                  <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border">
                        <Icon className={`size-5 ${tint}`} />
                      </span>
                      <div>
                        <p className="font-semibold">{account.label || meta?.name}</p>
                        <p className="text-sm text-muted-foreground">{meta?.name}</p>
                        <p className="mt-1 text-sm">{state.reason}</p>
                      </div>
                    </div>
                    {meta?.oauth && (
                      <Button size="sm" onClick={() => openConnector(meta)}>
                        <RefreshCw className="me-2 size-4" />{" "}
                        {t("integrationsAuditFixed.reconnect")}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </section>
        )}

        <section className="space-y-3">
          <SectionHeading
            title={t("integrationsAuditFixed.channels")}
            description={t("integrationsAuditFixed.eachChannelConnectsOnIts")}
          />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {CHANNELS.map((id) => {
              const connector = CONNECTORS.find((c) => c.id === id);
              if (!connector) return null;
              return (
                <ChannelCard
                  key={id}
                  connector={connector}
                  readiness={readinessMap.get(id) ?? null}
                  connected={
                    id === "whatsapp"
                      ? waNumbers.map((n) => ({ id: n.id, label: n.display_phone || n.label }))
                      : accounts.filter((a) => a.platform === id)
                  }
                  isSuperAdmin={isSuperAdmin}
                  onOpen={() => {
                    setBlocked(null);
                    setChannel(id);
                  }}
                />
              );
            })}
          </div>
        </section>

        <section className="space-y-3">
          <SectionHeading
            title={t("integrationsAuditFixed.connectedIntegrations")}
            description={t("integrationsAuditFixed.accountsAndChannelsCurrentlyLinked")}
          />
          {connections.isLoading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-52" />
              ))}
            </div>
          ) : connections.isError ? null : accounts.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <Link2 className="size-6" />
                <div>
                  <p className="font-semibold">
                    {t("integrationsAuditFixed.connectYourFirstIntegration")}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t("integrationsAuditFixed.facebookInstagramYoutubeWhatsappAnd")}
                  </p>
                </div>
                <Button onClick={() => setMarketplaceOpen(true)}>
                  <Plus className="me-2 size-4" /> {t("integrationsAuditFixed.addIntegration")}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {accounts.map((account) => (
                <ConnectedCard
                  key={account.id}
                  account={account}
                  disconnecting={remove.isPending}
                  onReconnect={() => {
                    const c = CONNECTORS.find((x) => x.id === account.platform);
                    if (c) openConnector(c);
                  }}
                  onDisconnect={() => remove.mutate(account.id)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <SectionHeading
              title={t("integrationsAuditFixed.exploreIntegrations")}
              description={t("integrationsAuditFixed.addAnotherChannelWithoutTouching")}
            />
            <Button variant="ghost" size="sm" onClick={() => setMarketplaceOpen(true)}>
              {t("integrationsAuditFixed.viewAll")} <ArrowRight className="ms-1 size-4" />
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {CONNECTORS.filter((c) => POPULAR.has(c.id))
              .slice(0, 6)
              .map((c) => (
                <MarketplacePreview
                  key={c.id}
                  connector={c}
                  onClick={() => {
                    setBlocked(null);
                    setCategory("popular");
                    setQuery(c.name);
                    setMarketplaceOpen(true);
                  }}
                />
              ))}
          </div>
        </section>

        {isAdmin && (
          <details id="channel-setup" className="rounded-xl border p-4">
            <summary className="cursor-pointer font-medium">
              {t("integrationsAuditFixed.advancedAdminSettings")}
            </summary>
            <div className="mt-4 space-y-4">
              <WorkspaceApps
                rows={rows}
                onConfigure={(id) => {
                  setBlocked(null);
                  setSetupReturnTo(null);
                  setCredentialsFor(id);
                }}
              />
              <IntegrationSettings />
              <IntegrationLogs />
            </div>
          </details>
        )}
        <section id="ai-keys" className="scroll-mt-20 space-y-3">
          <SectionHeading
            title={t("integrationsAuditFixed.yourOwnAiKeys")}
            description={t("integrationsAuditFixed.optionalUseYourOwnAi")}
          />
          <AiKeysCard />
        </section>
      </div>

      <Dialog
        open={marketplaceOpen}
        onOpenChange={(open) => {
          setMarketplaceOpen(open);
          setBlocked(null);
          if (!open) setQuery("");
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("integrationsAuditFixed.addIntegration")}</DialogTitle>
            <DialogDescription>
              {t("integrationsAuditFixed.chooseAPlatformContinueWith")}
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="ps-9"
              placeholder={t("integrationsAuditFixed.searchIntegrations")}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setBlocked(null);
              }}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { id: "popular", label: "Popular" },
              ...Object.entries(GROUP_LABELS).map(([id, label]) => ({ id, label })),
            ].map((item) => (
              <Button
                key={item.id}
                size="sm"
                variant={category === item.id ? "default" : "outline"}
                onClick={() => chooseCategory(item.id as "popular" | ConnectorGroup)}
              >
                {hasMessage(`integrationsAuditFixed.group.${item.id}`)
                  ? t(`integrationsAuditFixed.group.${item.id}` as MessageKey)
                  : item.label}
              </Button>
            ))}
          </div>
          {blocked && (
            <Problem
              message={blocked.message}
              calm={blocked.calm}
              onAdmin={isSuperAdmin ? () => openDiagnostics(blocked.platform) : undefined}
            />
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {marketplaceItems.map((connector) => (
              <MarketplaceCard
                key={connector.id}
                connector={connector}
                readiness={readinessMap.get(connector.id) ?? null}
                connecting={connecting === connector.id}
                isAdmin={isAdmin}
                isSuperAdmin={isSuperAdmin}
                onConnect={() => openConnector(connector)}
              />
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {isSuperAdmin && (
        <Dialog open={providerSetupOpen} onOpenChange={setProviderSetupOpen}>
          <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t("integrationsAuditFixed.adminDiagnostics")}</DialogTitle>
              <DialogDescription>
                {t("integrationsAuditFixed.adminOnlyReadinessAProvider")}
              </DialogDescription>
            </DialogHeader>
            <ProviderReadiness
              rows={rows}
              onConfigure={(id) => setCredentialsFor(id)}
              onConnect={beginConnect}
              connecting={connect.isPending}
            />
          </DialogContent>
        </Dialog>
      )}

      <Dialog
        open={Boolean(channelConnector)}
        onOpenChange={(open) => {
          if (!open) setChannel(null);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          {channelConnector && (
            <ChannelSetup
              connector={channelConnector}
              readiness={readinessMap.get(channelConnector.id) ?? null}
              connected={accounts.filter((a) => a.platform === channelConnector.id)}
              busy={connect.isPending}
              isAdmin={isAdmin}
              isSuperAdmin={isSuperAdmin}
              onConnect={() => openConnector(channelConnector)}
              onDisconnect={(id) => remove.mutate(id)}
              waNumbers={channelConnector.id === "whatsapp" ? waNumbers : []}
              onUseOwnApp={
                isAdmin && channelConnector.oauth && channelConnector.provider
                  ? () => {
                      setChannel(null);
                      setSetupReturnTo(channelConnector.id);
                      setCredentialsFor(channelConnector.id);
                    }
                  : undefined
              }
              onAddNumber={
                isAdmin && channelConnector.id === "whatsapp" ? openWhatsAppNumberSetup : undefined
              }
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(confirming)}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <DialogContent className="max-w-lg">
          {confirmConnector && (
            <ConnectConsent
              connector={confirmConnector}
              busy={connect.isPending}
              onCancel={() => setConfirming(null)}
              onContinue={() => beginConnect(confirmConnector.id)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={isAdmin && Boolean(credentialsFor)}
        onOpenChange={(open) => {
          if (!open) setCredentialsFor(null);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {credentialConnector
                ? t("integrationsAuditFixed.advancedWorkspaceApp", {
                    name: credentialConnector.name,
                  })
                : t("integrationsAuditFixed.advancedWorkspaceApp2")}
            </DialogTitle>
            <DialogDescription>
              {t("integrationsAuditFixed.flasNormallyProvidesTheShared")}
            </DialogDescription>
          </DialogHeader>
          {spec && credentialConnector ? (
            <CredentialsStep
              key={credentialConnector.id}
              spec={spec}
              platformName={credentialConnector.name}
              redirectUri={`${origin}${OAUTH_REDIRECT_PATH}`}
              continueLabel={
                credentialConnector.oauth
                  ? `Save and ${signInLabel(credentialConnector.provider, credentialConnector.name).replace(/^Continue/, "continue")}`
                  : "Save settings"
              }
              onSaved={() => {
                void qc.invalidateQueries({ queryKey: ["integration-readiness"] });
                setCredentialsFor(null);
                if (credentialConnector.oauth) {
                  beginConnect(continueTarget(credentialConnector.id, setupReturnTo, CONNECTORS));
                }
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("integrationsAuditFixed.thisIntegrationDoesNotRequire")}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Problem({
  message,
  onAdmin,
  blockers = [],
  calm = false,
  title,
}: {
  message: string;
  onAdmin: (() => void) | undefined;
  /** Overrides the heading when the trouble is not a connection's setup. */
  title?: string | undefined;
  /** FLAS staff see exactly what is missing; companies never do. */
  blockers?: ReadinessBlocker[];
  /** Nothing for this person to do: say so without a warning. */
  calm?: boolean | undefined;
}) {
  const { t } = useI18n();
  if (calm) {
    return (
      <div role="status" className="rounded-xl border bg-muted/40 p-4">
        <div className="flex gap-3">
          <Clock className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div>
            <p className="font-medium">{t("integrationsAuditFixed.notAvailableToConnectYet")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{message}</p>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-amber-300/60 bg-amber-50/60 p-4 dark:bg-amber-950/10">
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
        <div>
          <p className="font-medium">
            {title ?? t("integrationsAuditFixed.thisConnectionNeedsSetupBefore")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{message}</p>
          {blockers.length > 0 && (
            <ul className="mt-2 space-y-1.5 text-sm">
              {blockers.map((b) => (
                <li key={b.code} className="break-words">
                  <span className="font-medium">{b.title}</span>
                  <span className="text-muted-foreground"> - {b.userMessage}</span>
                  {b.technical ? (
                    <code className="ms-1 rounded bg-muted px-1 text-xs">{b.technical}</code>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {onAdmin && (
            <Button className="mt-3" size="sm" variant="outline" onClick={onAdmin}>
              {t("integrationsAuditFixed.openProviderSetup")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ProviderReadiness({
  rows,
  onConfigure,
  onConnect,
  connecting,
}: {
  rows: IntegrationReadinessRow[];
  onConfigure: (id: string) => void;
  onConnect: (id: string) => void;
  connecting: boolean;
}) {
  const { t } = useI18n();
  const oauthFamilies = rows.filter((r) => r.oauth);
  const utility = rows.filter((r) =>
    ["whatsapp", "wordpress", "shopify", "woocommerce"].includes(r.id),
  );
  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-2 text-sm font-semibold">{t("integrationsAuditFixed.oauthProviders")}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {oauthFamilies.map((row) => (
            <ReadinessCard
              key={row.id}
              row={row}
              onConfigure={() => onConfigure(row.id)}
              onConnect={() => onConnect(row.id)}
              connecting={connecting}
            />
          ))}
        </div>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">
          {t("integrationsAuditFixed.messagingWebsite")}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {utility.map((row) => (
            <ReadinessCard key={row.id} row={row} onConfigure={() => onConfigure(row.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ReadinessCard({
  row,
  onConfigure,
  onConnect,
  connecting = false,
}: {
  row: IntegrationReadinessRow;
  onConfigure: () => void;
  onConnect?: () => void;
  connecting?: boolean;
}) {
  const { t, tr } = useI18n();
  const setup = providerSetup(row.provider);
  const label = row.name;
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{label}</CardTitle>
          <StatusBadge row={row} />
        </div>
        <CardDescription>
          {row.source === "workspace"
            ? t("integrationsAuditFixed.workspaceCredentials")
            : row.source === "shared"
              ? t("integrationsAuditFixed.sharedFlasCredentials")
              : row.oauth
                ? t("integrationsAuditFixed.credentialsNotConfigured")
                : row.name}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <CheckLine
          ok={row.checks.credentials}
          label={
            row.credentials.idLabel && row.credentials.secretLabel
              ? `${row.credentials.idLabel} + ${row.credentials.secretLabel}`
              : t("integrationsAuditFixed.credentials")
          }
          hint={credentialHint(row)}
        />
        <CheckLine
          ok={row.checks.allowedOrigin}
          label={t("integrationsAuditFixed.oauthReturnAddress")}
        />
        <CheckLine ok={row.checks.publicAppUrl} label={t("integrationsAuditFixed.publicAppUrl")} />
        <CheckLine ok={row.checks.encryption} label={t("integrationsAuditFixed.tokenEncryption")} />
        <CheckLine
          ok={row.checks.storage}
          label={t("integrationsAuditFixed.oauthDatabaseSchema")}
        />
        {row.callbackUri && (
          <CopyRow label={t("integrationsAuditFixed.callback")} value={row.callbackUri} />
        )}
        {row.blockers
          .filter((b) => b.severity !== "INFO" && !CREDENTIAL_CODES.has(b.code))
          .map((b) => (
            <div
              key={b.code}
              className={`rounded-md border p-2 ${
                b.severity === "BLOCKING" ? "border-amber-300/50" : "border-border"
              }`}
            >
              <p className="font-medium">{b.title}</p>
              {b.userMessage && <p className="mt-0.5 text-xs">{b.userMessage}</p>}
              {b.technical && (
                <p className="mt-1 break-words text-xs text-muted-foreground">{b.technical}</p>
              )}
            </div>
          ))}
        {row.blockers.some((b) => b.severity === "INFO") && (
          <details className="rounded-md border p-2">
            <summary className="cursor-pointer text-xs font-medium">
              {tr("integrationsAuditFixed.providerSetupNotes", {
                length: row.blockers.filter((b) => b.severity === "INFO").length,
              })}
            </summary>
            <div className="mt-2 grid gap-2">
              {row.blockers
                .filter((b) => b.severity === "INFO")
                .map((b) => (
                  <div key={b.code}>
                    <p className="text-xs font-medium">{b.title}</p>
                    <p className="break-words text-xs text-muted-foreground">
                      {b.technical ?? b.userMessage}
                    </p>
                  </div>
                ))}
            </div>
          </details>
        )}
        <div className="flex flex-wrap gap-2">
          {row.oauth && (row.status === "READY" || row.status === "LIMITED") && onConnect && (
            <Button size="sm" onClick={onConnect} disabled={connecting}>
              {connecting
                ? t("integrationsAuditFixed.openingSecureSignIn")
                : signInLabel(row.provider, row.name)}
            </Button>
          )}
          {row.oauth && row.status !== "COMING_SOON" && (
            <Button size="sm" variant="outline" onClick={onConfigure} disabled={connecting}>
              <KeyRound className="me-1.5 size-3.5" />{" "}
              {t("integrationsAuditFixed.advancedWorkspaceApp3")}
            </Button>
          )}
          {setup?.links?.[0] && (
            <Button asChild size="sm" variant="outline">
              <a href={setup.links[0].url} target="_blank" rel="noreferrer noopener">
                {tr("integrationsAuditFixed.openSetup", { displayName: setup.displayName })}{" "}
                <ExternalLink className="ms-1 size-3.5" />
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** The two blockers that only repeat a failed credentials check. */
const CREDENTIAL_CODES = new Set(["PROVIDER_ID_MISSING", "PROVIDER_SECRET_MISSING"]);

/** What to set when a provider's keys are missing, said once. */
function credentialHint(row: IntegrationReadinessRow): string | undefined {
  if (row.checks.credentials) return undefined;
  const names = row.blockers
    .filter((b) => CREDENTIAL_CODES.has(b.code))
    .map((b) => b.technical?.replace(/^Missing /, ""))
    .filter((name): name is string => Boolean(name));
  return names.length > 0
    ? `Set ${names.join(" and ")} in the server secrets, then reload this page.`
    : undefined;
}

function CheckLine({ ok, label, hint }: { ok: boolean; label: string; hint?: string | undefined }) {
  const { t } = useI18n();
  return (
    <div className="flex items-start gap-2">
      {ok ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
      ) : (
        <XCircle className="mt-0.5 size-4 shrink-0 text-amber-600" />
      )}
      <span className="min-w-0">
        {label}: {ok ? t("integrationsAuditFixed.ready") : t("integrationsAuditFixed.missing")}
        {hint && (
          <span className="mt-0.5 block break-words text-xs text-muted-foreground">{hint}</span>
        )}
      </span>
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-md bg-muted/40 p-2">
      <p className="mb-1 text-xs font-medium">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate text-[11px]">{value}</code>
        <Button
          size="sm"
          variant="ghost"
          className="h-7"
          onClick={() => {
            void navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </Button>
      </div>
    </div>
  );
}

function StatusBadge({
  row,
  forCompany = false,
}: {
  row: IntegrationReadinessRow;
  /** Seen by a company rather than FLAS staff. */
  forCompany?: boolean;
}) {
  const { t } = useI18n();
  if (row.status === "READY") return <Badge>{t("integrationsAuditFixed.available")}</Badge>;
  if (row.status === "LIMITED")
    return <Badge variant="secondary">{t("integrationsAuditFixed.limited")}</Badge>;
  if (row.status === "COMING_SOON")
    return <Badge variant="outline">{t("integrationsAuditFixed.comingSoon")}</Badge>;
  if (forCompany && row.setupOwner !== "workspace")
    return <Badge variant="secondary">{t("integrationsAuditFixed.availableSoon")}</Badge>;
  return <Badge variant="secondary">{t("integrationsAuditFixed.setupNeeded")}</Badge>;
}

function MarketplaceCard({
  connector,
  readiness,
  connecting,
  isAdmin,
  isSuperAdmin = false,
  onConnect,
}: {
  connector: Connector;
  readiness: IntegrationReadinessRow | null;
  connecting: boolean;
  isAdmin: boolean;
  isSuperAdmin?: boolean;
  onConnect: () => void;
}) {
  const { t } = useI18n();
  const { icon: Icon, tint } = connectorIcon(connector.id);
  const status =
    readiness?.status ?? (connector.unavailableReason ? "COMING_SOON" : "ADMIN_SETUP_REQUIRED");
  const setupNeeded = status === "ADMIN_SETUP_REQUIRED";
  // A step the company takes itself (only its admins can); anything else is
  // FLAS finishing its own setup, which nobody in the company can fix.
  const workspaceStep = setupNeeded && readiness?.setupOwner === "workspace";
  const disabled =
    !readiness ||
    connecting ||
    status === "COMING_SOON" ||
    (setupNeeded && !isSuperAdmin && !(workspaceStep && isAdmin));
  const action =
    status === "COMING_SOON"
      ? "Coming soon"
      : setupNeeded
        ? isSuperAdmin
          ? "Fix setup"
          : workspaceStep
            ? isAdmin
              ? `Set up ${connector.name}`
              : "Ask your admin to set this up"
            : "Available soon"
        : connector.oauth
          ? `Continue with ${connector.provider === "meta" ? "Facebook" : connector.provider === "google" ? "Google" : connector.name}`
          : `Open ${connector.name}`;
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <span className="flex size-11 items-center justify-center rounded-xl border">
            <Icon className={`size-5 ${tint}`} />
          </span>
          {readiness ? (
            <StatusBadge row={readiness} forCompany={!isSuperAdmin} />
          ) : (
            <Badge variant="secondary">{t("integrationsAuditFixed.checking")}</Badge>
          )}
        </div>
        <CardTitle className="pt-2 text-base">{connector.name}</CardTitle>
        <CardDescription>{connector.blurb}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <div className="space-y-1 text-xs text-muted-foreground">
          {friendlyCapability(connector.id)
            .slice(0, 3)
            .map((cap) => (
              <div key={cap} className="flex items-center gap-1.5">
                {cap}
              </div>
            ))}
        </div>
        {connector.limitedReason && (
          <p className="text-xs text-muted-foreground">{connector.limitedReason}</p>
        )}
        {connector.oauth && (
          <p className="text-xs text-muted-foreground">
            {t("integrationsAuditFixed.featuresDependOnYourAccount")}
          </p>
        )}
        {readiness?.blockers.some((b) => b.severity === "BLOCKING") && (
          <p className="text-xs text-muted-foreground">
            {readiness.blockers.find((b) => b.severity === "BLOCKING")?.userMessage}
          </p>
        )}
        <div className="mt-auto pt-2">
          <Button
            className="w-full"
            variant={setupNeeded ? "outline" : "default"}
            onClick={onConnect}
            disabled={disabled}
          >
            {!readiness
              ? t("integrationsAuditFixed.checkingAvailability")
              : connecting
                ? t("integrationsAuditFixed.openingSecureSignIn")
                : action}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ConnectedCard({
  account,
  disconnecting,
  onReconnect,
  onDisconnect,
}: {
  account: Account;
  disconnecting: boolean;
  onReconnect: () => void;
  onDisconnect: () => void;
}) {
  const { t } = useI18n();
  const meta = CONNECTORS.find((c) => c.id === account.platform);
  const state = connectionStatus(account);
  const { icon: Icon, tint } = connectorIcon(account.platform);
  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border">
              <Icon className={`size-5 ${tint}`} />
            </span>
            <div className="min-w-0">
              <CardTitle className="truncate text-base">{account.label || meta?.name}</CardTitle>
              <CardDescription>{meta?.name}</CardDescription>
            </div>
          </div>
          <Badge
            variant={
              state.tone === "good" ? "default" : state.tone === "bad" ? "destructive" : "secondary"
            }
          >
            {state.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="text-muted-foreground">{t("integrationsAuditFixed.lastVerified")}</p>
            <p className="mt-1 font-medium">{humanTime(account.last_synced_at)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{t("integrationsAuditFixed.lastSync")}</p>
            <p className="mt-1 font-medium">{humanTime(account.last_synced_at)}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {friendlyCapability(account.platform).map((cap) => (
            <Badge key={cap} variant="secondary" className="font-normal">
              {cap}
            </Badge>
          ))}
        </div>
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          {account.profile_url && (
            <Button asChild size="sm" variant="outline">
              <a href={account.profile_url} target="_blank" rel="noreferrer noopener">
                {t("integrationsAuditFixed.open")} <ExternalLink className="ms-1 size-3.5" />
              </a>
            </Button>
          )}
          {meta?.oauth && (
            <Button size="sm" variant="outline" onClick={onReconnect}>
              <RefreshCw className="me-1 size-3.5" /> {t("integrationsAuditFixed.reconnect")}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={disconnecting}
            onClick={onDisconnect}
          >
            <Unplug className="me-1 size-3.5" /> {t("integrationsAuditFixed.disconnect")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MarketplacePreview({ connector, onClick }: { connector: Connector; onClick: () => void }) {
  const { icon: Icon, tint } = connectorIcon(connector.id);
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-xl border p-4 text-start transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex size-10 items-center justify-center rounded-xl border">
        <Icon className={`size-5 ${tint}`} />
      </span>
      <span>
        <span className="block font-medium">{connector.name}</span>
        <span className="line-clamp-1 text-xs text-muted-foreground">{connector.blurb}</span>
      </span>
    </button>
  );
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
  loading = false,
}: {
  label: string;
  value: number;
  tone: "good" | "warn" | "muted";
  /** A zero we have not verified is a wrong answer, so show nothing instead. */
  loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="stat-label">{label}</p>
          {loading ? (
            <Skeleton className="mt-2 h-7 w-10" />
          ) : (
            <p className="stat-figure mt-1.5 text-[1.75rem] font-bold">{value}</p>
          )}
        </div>
        <span
          className={`size-2.5 rounded-full ${
            tone === "good"
              ? "bg-emerald-500"
              : tone === "warn"
                ? "bg-amber-500"
                : "bg-muted-foreground/30"
          }`}
        />
      </CardContent>
    </Card>
  );
}

function platformName(id: string): string {
  return CONNECTORS.find((c) => c.id === id)?.name ?? "This integration";
}

/** What a company is told while FLAS itself finishes setting a connection up. */
function notYetMessage(name: string): string {
  return `${name} isn't available to connect yet. FLAS is finishing its setup, so there is nothing you need to do. Please check back soon.`;
}

/**
 * Optional: a company can connect through its own provider app instead of the
 * FLAS one. Kept in Advanced settings on purpose, because nearly every company
 * should simply use Continue with Facebook.
 */
function WorkspaceApps({
  rows,
  onConfigure,
}: {
  rows: IntegrationReadinessRow[];
  onConfigure: (id: string) => void;
}) {
  const { t } = useI18n();
  const families: IntegrationReadinessRow[] = [];
  for (const row of rows) {
    if (!row.oauth || !row.provider || row.status === "COMING_SOON") continue;
    if (!families.some((f) => f.provider === row.provider)) families.push(row);
  }
  if (families.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          {t("integrationsAuditFixed.useYourOwnDeveloperApp")}
        </CardTitle>
        <CardDescription>{t("integrationsAuditFixed.mostCompaniesNeverNeedThis")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {families.map((row) => (
          <div key={row.provider} className="space-y-2 rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">{row.providerName ?? row.name}</p>
                <p className="text-xs text-muted-foreground">
                  {rows
                    .filter((r) => r.provider === row.provider && r.status !== "COMING_SOON")
                    .map((r) => r.name)
                    .join(", ")}
                  {" · "}
                  {row.source === "workspace"
                    ? t("integrationsAuditFixed.usingYourOwnApp")
                    : row.source === "shared"
                      ? t("integrationsAuditFixed.usingTheFlasApp")
                      : t("integrationsAuditFixed.notAvailableYet")}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => onConfigure(row.id)}>
                <KeyRound className="me-1.5 size-3.5" />
                {row.source === "workspace"
                  ? t("integrationsAuditFixed.updateYourAppKeys")
                  : t("integrationsAuditFixed.useYourOwnApp")}
              </Button>
            </div>
            {row.source === "workspace" && (
              // The company owns this app, so it has to register FLAS in it.
              <div className="space-y-2 text-xs text-muted-foreground">
                {row.callbackUri && (
                  <CopyRow
                    label={t("integrationsAuditFixed.registerThisCallbackInYour")}
                    value={row.callbackUri}
                  />
                )}
                {row.blockers
                  .filter((b) => b.owner === "WORKSPACE_ADMIN" && b.technical)
                  .map((b) => (
                    <p key={b.code} className="break-words">
                      {b.technical}
                    </p>
                  ))}
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * Shown before a provider's own consent screen: what FLAS will ask for, what
 * the person chooses next, and a way out that contacts nobody.
 */
function ConnectConsent({
  connector,
  busy,
  onCancel,
  onContinue,
}: {
  connector: Connector;
  busy: boolean;
  onCancel: () => void;
  onContinue: () => void;
}) {
  const { t, tr } = useI18n();
  const provider = connector.provider === "meta" ? "Facebook" : (connector.name ?? "the provider");
  const permissions = plainPermissions(connectorDefinition(connector.id)?.requestedScopes);
  const { icon: Icon, tint } = connectorIcon(connector.id);
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Icon className={`size-5 ${tint}`} />{" "}
          {tr("integrationsAuditFixed.connect", { name: connector.name })}
        </DialogTitle>
        <DialogDescription>
          {tr("integrationsAuditFixed.flasWillAskForPermission", {
            provider: provider,
            pickerNoun: pickerNoun(connector.id),
            provider2: provider,
          })}
        </DialogDescription>
      </DialogHeader>
      {permissions.length > 0 ? (
        <ul className="grid gap-2 rounded-xl border bg-muted/30 p-4 text-sm">
          {permissions.map((line) => (
            <li key={line} className="flex items-start gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border bg-muted/30 p-4 text-sm">
          {tr("integrationsAuditFixed.youLlBeAskedTo", { name: connector.name })}
        </p>
      )}
      {connector.limitedReason && (
        <p className="text-xs text-muted-foreground">{connector.limitedReason}</p>
      )}
      <p className="text-xs text-muted-foreground">
        {handoffNote(provider, pickerNoun(connector.id))}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          {t("integrationsAuditFixed.cancel")}
        </Button>
        <Button onClick={onContinue} disabled={busy}>
          {busy
            ? t("integrationsAuditFixed.openingSecureSignIn")
            : signInLabel(connector.provider, connector.name)}
        </Button>
      </div>
    </>
  );
}

/** How one channel stands right now, in a word a company uses. */
function channelState(
  readiness: IntegrationReadinessRow | null,
  connected: ReadonlyArray<{ id: string }>,
  isSuperAdmin: boolean,
  t: Translate,
): { label: string; tone: "good" | "warn" | "muted" } {
  if (connected.length > 0)
    return {
      label:
        connected.length > 1
          ? t("integrationsAuditFixed.state.connectedCount", { count: connected.length })
          : t("integrationsAuditFixed.connected"),
      tone: "good",
    };
  if (!readiness) return { label: t("integrationsAuditFixed.state.checking"), tone: "muted" };
  if (readiness.status === "COMING_SOON")
    return { label: t("integrationsAuditFixed.comingSoon"), tone: "muted" };
  if (readiness.status === "ADMIN_SETUP_REQUIRED")
    return {
      label:
        isSuperAdmin || readiness.setupOwner === "workspace"
          ? t("integrationsAuditFixed.setupNeeded")
          : t("integrationsAuditFixed.availableSoon"),
      tone: "warn",
    };
  return { label: t("integrationsAuditFixed.state.notConnected"), tone: "muted" };
}

function ChannelCard({
  connector,
  readiness,
  connected,
  isSuperAdmin,
  onOpen,
}: {
  connector: Connector;
  readiness: IntegrationReadinessRow | null;
  connected: ReadonlyArray<{ id: string; label: string }>;
  isSuperAdmin: boolean;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const { icon: Icon, tint } = connectorIcon(connector.id);
  const state = channelState(readiness, connected, isSuperAdmin, t);
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border">
            <Icon className={`size-5 ${tint}`} />
          </span>
          <div className="min-w-0">
            <p className="font-semibold">{connector.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {connected[0]?.label || state.label}
            </p>
          </div>
        </div>
        <Button size="sm" variant={connected.length > 0 ? "outline" : "default"} onClick={onOpen}>
          {connected.length > 0
            ? t("integrationsAuditFixed.manage")
            : t("integrationsAuditFixed.setUp")}
        </Button>
      </CardContent>
    </Card>
  );
}

/** One channel's own page: what it does, what to do, and where it stands. */
function ChannelSetup({
  connector,
  readiness,
  connected,
  busy,
  isAdmin,
  isSuperAdmin,
  onConnect,
  onDisconnect,
  waNumbers = [],
  onUseOwnApp,
  onAddNumber,
}: {
  connector: Connector;
  readiness: IntegrationReadinessRow | null;
  connected: Account[];
  busy: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  onConnect: () => void;
  onDisconnect: (id: string) => void;
  /** Connected WhatsApp numbers, for the WhatsApp page. */
  waNumbers?: WaNumber[];
  /** Admins: connect through the company's own provider app instead. */
  onUseOwnApp?: (() => void) | undefined;
  /** Admins: add a WhatsApp number by hand. */
  onAddNumber?: (() => void) | undefined;
}) {
  const { t, tr } = useI18n();
  const { icon: Icon, tint } = connectorIcon(connector.id);
  const state = channelState(
    readiness,
    connector.id === "whatsapp" ? waNumbers : connected,
    isSuperAdmin,
    t,
  );
  const steps = connectSteps(connector.id, connector.name, connector.provider);
  const providerName = readiness?.providerName ?? connector.name;
  const waitingOnFlas =
    readiness?.status === "ADMIN_SETUP_REQUIRED" && readiness.setupOwner !== "workspace";
  const comingSoon = readiness?.status === "COMING_SOON";
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Icon className={`size-5 ${tint}`} /> {connector.name}
          <Badge variant={state.tone === "good" ? "default" : "secondary"}>{state.label}</Badge>
        </DialogTitle>
        <DialogDescription>{connector.blurb}</DialogDescription>
      </DialogHeader>

      {connected.length > 0 && (
        <div className="grid gap-2">
          {connected.map((account) => (
            <div key={account.id} className="grid gap-2 rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{account.label || connector.name}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => onDisconnect(account.id)}
                >
                  <Unplug className="me-1 size-3.5" /> {t("integrationsAuditFixed.disconnect")}
                </Button>
              </div>
              {account.external_id && (
                <CopyRow label={accountIdLabel(connector.id)} value={account.external_id} />
              )}
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">{t("integrationsAuditFixed.connectedBy")}</dt>
                <dd>
                  {account.connect_method === "oauth"
                    ? t("integrationsAuditFixed.signIn", { providerName: providerName })
                    : t("integrationsAuditFixed.manualSetup")}
                </dd>
                {account.created_at && (
                  <>
                    <dt className="text-muted-foreground">
                      {t("integrationsAuditFixed.connectedOn")}
                    </dt>
                    <dd>{new Date(account.created_at).toLocaleDateString()}</dd>
                  </>
                )}
                {account.token_expires_at && (
                  <>
                    <dt className="text-muted-foreground">
                      {t("integrationsAuditFixed.accessValidUntil")}
                    </dt>
                    <dd>{new Date(account.token_expires_at).toLocaleDateString()}</dd>
                  </>
                )}
              </dl>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("integrationsAuditFixed.howToConnect")}
        </p>
        <ol className="grid gap-2 text-sm">
          {steps.map((step, i) => (
            <li key={step} className="flex gap-3">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full border text-xs font-medium">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>

      {comingSoon && connector.unavailableReason && (
        <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          {connector.unavailableReason}
          {isAdmin && connector.id === "whatsapp"
            ? t("integrationsAuditFixed.anAdministratorAddsNumbersFrom")
            : ""}
        </p>
      )}
      {waitingOnFlas && !comingSoon && (
        <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          {notYetMessage(connector.name)}
        </p>
      )}

      {waNumbers.length > 0 && (
        <div className="grid gap-2">
          {waNumbers.map((number) => (
            <div key={number.id} className="grid gap-2 rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{number.display_phone || number.label}</span>
                {number.is_default && (
                  <Badge variant="secondary">{t("integrationsAuditFixed.default")}</Badge>
                )}
              </div>
              <CopyRow
                label={t("integrationsAuditFixed.phoneNumberId")}
                value={number.phone_number_id}
              />
            </div>
          ))}
        </div>
      )}

      {(onUseOwnApp || onAddNumber) && (
        <div className="grid gap-2 rounded-lg border border-dashed p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("integrationsAuditFixed.anotherWayToConnect")}
          </p>
          {onUseOwnApp && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <p className="min-w-0 flex-1 text-muted-foreground">
                {tr("integrationsAuditFixed.connectThroughAAppYour", {
                  providerName: providerName,
                })}
              </p>
              <Button
                size="sm"
                variant={waitingOnFlas ? "default" : "outline"}
                onClick={onUseOwnApp}
              >
                <KeyRound className="me-1.5 size-3.5" />{" "}
                {tr("integrationsAuditFixed.useYourOwnApp2", { providerName: providerName })}
              </Button>
            </div>
          )}
          {onAddNumber && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <p className="min-w-0 flex-1 text-muted-foreground">
                {t("integrationsAuditFixed.addAWhatsappBusinessNumber")}
              </p>
              <Button size="sm" onClick={onAddNumber}>
                {t("integrationsAuditFixed.addANumberManually")}
              </Button>
            </div>
          )}
        </div>
      )}

      {connector.oauth && !comingSoon && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onConnect} disabled={busy || waitingOnFlas}>
            {busy
              ? t("integrationsAuditFixed.openingSecureSignIn")
              : connected.length > 0
                ? t("integrationsAuditFixed.reconnect2", { name: connector.name })
                : signInLabel(connector.provider, connector.name)}
          </Button>
        </div>
      )}
    </>
  );
}
