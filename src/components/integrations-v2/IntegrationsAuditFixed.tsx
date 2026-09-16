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
import { connectionStatus } from "@/lib/connection-status";
import { disconnectConnection, getConnections, startConnect } from "@/lib/connections.functions";
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
  Copy,
  ExternalLink,
  KeyRound,
  Link2,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Unplug,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

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
};

const GROUP_LABELS: Record<ConnectorGroup, string> = {
  social: "Social",
  messaging: "Messaging",
  ads: "Advertising",
  analytics: "Analytics",
  commerce: "Website & Commerce",
};

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

export function IntegrationsAuditFixed({
  search = {},
  onDismiss = () => {},
}: {
  search?: ConnectionOutcomeSearch;
  onDismiss?: () => void;
}) {
  const { isAdmin } = useAuth();
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
  const [credentialsFor, setCredentialsFor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"popular" | ConnectorGroup>("popular");
  const [connecting, setConnecting] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ platform: string; message: string } | null>(null);

  const allAccounts = (connections.data?.accounts ?? []) as Account[];
  const accounts = allAccounts.filter((a) => a.active && a.external_id);
  const pendingAccounts = allAccounts.filter(
    (a) => a.active && !a.external_id && a.connect_method === "oauth",
  );
  const [resume, setResume] = useState<ConnectionOutcomeSearch | null>(null);
  const rows = readiness.data?.rows ?? [];
  const readinessMap = new Map(rows.map((r) => [r.id, r]));
  const attention = accounts.filter((a) => {
    const state = connectionStatus(a);
    return state.tone === "bad" || state.tone === "warn";
  });
  const available = rows.filter((r) => r.status === "READY" || r.status === "LIMITED").length;
  const comingSoon = rows.filter((r) => r.status === "COMING_SOON").length;

  const marketplaceItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CONNECTORS.filter((c) => {
      if (category === "popular" && !POPULAR.has(c.id)) return false;
      if (category !== "popular" && c.group !== category) return false;
      return !q || `${c.name} ${c.blurb} ${GROUP_LABELS[c.group]}`.toLowerCase().includes(q);
    });
  }, [category, query]);

  const connect = useMutation({
    mutationFn: async (platform: string) => {
      setBlocked(null);
      setConnecting(platform);
      return start({ data: { platform: platform as never, origin: window.location.origin } });
    },
    onSuccess: (result, platform) => {
      setConnecting(null);
      if (!result.ready) {
        setBlocked({
          platform,
          message:
            "This connection is temporarily unavailable while administrator setup is completed.",
        });
        return;
      }
      window.location.assign(result.url);
    },
    onError: (_e: Error, platform) => {
      setConnecting(null);
      setBlocked({
        platform,
        message: "The connection could not start. Please try again or ask an administrator.",
      });
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
      if (isAdmin && (connector.oauth || connector.id === "whatsapp")) {
        setProviderSetupOpen(true);
      } else {
        setBlocked({
          platform: connector.id,
          message: "This integration needs administrator setup before it can connect.",
        });
      }
      return;
    }
    if (row?.status === "COMING_SOON") return;
    if (connector.oauth) {
      connect.mutate(connector.id);
      return;
    }
    if (connector.internalHref && connector.internalHref !== "/connect") {
      window.location.href = connector.internalHref;
      return;
    }
    toast.info(`${connector.name} setup is managed from this Integrations page.`);
  }

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
            title="Integrations"
            description="Connect the tools your team uses and manage every account from one clear place."
          />
          <div className="flex flex-wrap gap-2">
            {isAdmin && (
              <Button
                variant="outline"
                onClick={() => {
                  setBlocked(null);
                  setProviderSetupOpen(true);
                }}
              >
                <Settings2 className="mr-2 size-4" /> Admin diagnostics
              </Button>
            )}
            <Button
              onClick={() => {
                setBlocked(null);
                setMarketplaceOpen(true);
              }}
            >
              <Plus className="mr-2 size-4" /> Add Integration
            </Button>
          </div>
        </div>

        {connections.isError && (
          <Problem
            message="We could not load your integrations. Please refresh and try again."
            onAdmin={undefined}
          />
        )}
        {readiness.isError && (
          <Problem
            message="We could not check connection availability. Please refresh and try again."
            onAdmin={undefined}
          />
        )}
        {blocked && !marketplaceOpen && (
          <Problem
            message={blocked.message}
            onAdmin={isAdmin ? () => setProviderSetupOpen(true) : undefined}
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
        />
        {pendingAccounts.length > 0 && !search.select_target && !resume && (
          <section className="space-y-3">
            <SectionHeading
              title="Finish connecting"
              description="Sign-in is saved. Choose the Page or account to complete the connection."
            />
            {pendingAccounts.map((account) => (
              <Button
                key={account.id}
                variant="outline"
                onClick={() =>
                  setResume({ connected: account.platform, select_target: account.id })
                }
              >
                Choose {CONNECTORS.find((c) => c.id === account.platform)?.name ?? "account"}
              </Button>
            ))}
          </section>
        )}
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Connected" value={accounts.length} tone="good" />
          <StatCard
            label="Needs attention"
            value={attention.length}
            tone={attention.length ? "warn" : "muted"}
          />
          <StatCard label="Ready to connect" value={available} tone="muted" />
          <StatCard label="Coming soon" value={comingSoon} tone="muted" />
        </section>

        {attention.length > 0 && (
          <section className="space-y-3">
            <SectionHeading
              title="Needs attention"
              description="Fix these first so your automations and reporting keep working."
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
                        <RefreshCw className="mr-2 size-4" /> Reconnect
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
            title="Connected integrations"
            description="Accounts and channels currently linked to this workspace."
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
                  <p className="font-semibold">Connect your first integration</p>
                  <p className="text-sm text-muted-foreground">
                    Facebook, Instagram, YouTube, WhatsApp and more can live in FLAS.
                  </p>
                </div>
                <Button onClick={() => setMarketplaceOpen(true)}>
                  <Plus className="mr-2 size-4" /> Add Integration
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
              title="Explore integrations"
              description="Add another channel without touching developer settings."
            />
            <Button variant="ghost" size="sm" onClick={() => setMarketplaceOpen(true)}>
              View all <ArrowRight className="ml-1 size-4" />
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
            <summary className="cursor-pointer font-medium">Advanced admin settings</summary>
            <div className="mt-4 space-y-4">
              <IntegrationSettings />
              <IntegrationLogs />
            </div>
          </details>
        )}
        <section id="ai-keys" className="scroll-mt-20 space-y-3">
          <SectionHeading
            title="Your own AI keys"
            description="Optional: use your own AI provider account for the chatbot."
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
            <DialogTitle>Add Integration</DialogTitle>
            <DialogDescription>
              Choose a platform, continue with your account, then choose the channel to connect.
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search integrations..."
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
                {item.label}
              </Button>
            ))}
          </div>
          {blocked && (
            <Problem
              message={blocked.message}
              onAdmin={isAdmin ? () => setProviderSetupOpen(true) : undefined}
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
                onConnect={() => openConnector(connector)}
              />
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isAdmin && providerSetupOpen} onOpenChange={setProviderSetupOpen}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Admin diagnostics</DialogTitle>
            <DialogDescription>
              Admin-only readiness. A provider is Ready only when credentials, origin and secure
              token storage all pass.
            </DialogDescription>
          </DialogHeader>
          <ProviderReadiness rows={rows} onConfigure={(id) => setCredentialsFor(id)} />
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
                ? `Advanced workspace app: ${credentialConnector.name}`
                : "Advanced workspace app"}
            </DialogTitle>
            <DialogDescription>
              FLAS normally provides the shared app. Only use this optional override if your
              workspace administrator maintains a separate provider app. Secrets stay on the server.
            </DialogDescription>
          </DialogHeader>
          {spec && credentialConnector ? (
            <CredentialsStep
              spec={spec}
              platformName={credentialConnector.name}
              redirectUri={`${origin}${OAUTH_REDIRECT_PATH}`}
              onSaved={() => {
                void qc.invalidateQueries({ queryKey: ["integration-readiness"] });
                setCredentialsFor(null);
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              This integration does not require app credentials here.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Problem({ message, onAdmin }: { message: string; onAdmin: (() => void) | undefined }) {
  return (
    <div className="rounded-xl border border-amber-300/60 bg-amber-50/60 p-4 dark:bg-amber-950/10">
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
        <div>
          <p className="font-medium">This connection needs setup before it can continue</p>
          <p className="mt-1 text-sm text-muted-foreground">{message}</p>
          {onAdmin && (
            <Button className="mt-3" size="sm" variant="outline" onClick={onAdmin}>
              Open Provider Setup
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
}: {
  rows: IntegrationReadinessRow[];
  onConfigure: (id: string) => void;
}) {
  const oauthFamilies = rows.filter((r) => r.oauth);
  const utility = rows.filter((r) =>
    ["whatsapp", "wordpress", "shopify", "woocommerce"].includes(r.id),
  );
  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-2 text-sm font-semibold">OAuth providers</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {oauthFamilies.map((row) => (
            <ReadinessCard key={row.id} row={row} onConfigure={() => onConfigure(row.id)} />
          ))}
        </div>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">Messaging & website</h3>
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
}: {
  row: IntegrationReadinessRow;
  onConfigure: () => void;
}) {
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
            ? "Workspace credentials"
            : row.source === "shared"
              ? "Shared FLAS credentials"
              : row.oauth
                ? "Credentials not configured"
                : row.name}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <CheckLine
          ok={row.checks.credentials}
          label={
            row.credentials.idLabel && row.credentials.secretLabel
              ? `${row.credentials.idLabel} + ${row.credentials.secretLabel}`
              : "Credentials"
          }
        />
        <CheckLine ok={row.checks.allowedOrigin} label="OAuth return address" />
        <CheckLine ok={row.checks.publicAppUrl} label="Public app URL" />
        <CheckLine ok={row.checks.encryption} label="Token encryption" />
        <CheckLine ok={row.checks.storage} label="OAuth database schema" />
        {row.callbackUri && <CopyRow label="Callback" value={row.callbackUri} />}
        {row.blockers.map((b) => (
          <div key={b.code} className="rounded-md border border-amber-300/50 p-2">
            <p className="font-medium">{b.title}</p>
            {b.technical && (
              <p className="mt-1 break-words text-xs text-muted-foreground">{b.technical}</p>
            )}
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          {row.oauth && row.status !== "COMING_SOON" && (
            <Button size="sm" onClick={onConfigure}>
              <KeyRound className="mr-1.5 size-3.5" /> Advanced: workspace app
            </Button>
          )}
          {setup?.links?.[0] && (
            <Button asChild size="sm" variant="outline">
              <a href={setup.links[0].url} target="_blank" rel="noreferrer noopener">
                Open {setup.displayName} setup <ExternalLink className="ml-1 size-3.5" />
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function CheckLine({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {ok ? (
        <CheckCircle2 className="size-4 text-emerald-600" />
      ) : (
        <XCircle className="size-4 text-amber-600" />
      )}
      <span>
        {label}: {ok ? "Ready" : "Missing"}
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

function StatusBadge({ row }: { row: IntegrationReadinessRow }) {
  if (row.status === "READY") return <Badge>Available</Badge>;
  if (row.status === "LIMITED") return <Badge variant="secondary">Limited</Badge>;
  if (row.status === "COMING_SOON") return <Badge variant="outline">Coming soon</Badge>;
  return <Badge variant="secondary">Setup needed</Badge>;
}

function MarketplaceCard({
  connector,
  readiness,
  connecting,
  isAdmin,
  onConnect,
}: {
  connector: Connector;
  readiness: IntegrationReadinessRow | null;
  connecting: boolean;
  isAdmin: boolean;
  onConnect: () => void;
}) {
  const { icon: Icon, tint } = connectorIcon(connector.id);
  const status =
    readiness?.status ?? (connector.unavailableReason ? "COMING_SOON" : "ADMIN_SETUP_REQUIRED");
  const disabled =
    !readiness ||
    connecting ||
    status === "COMING_SOON" ||
    (status === "ADMIN_SETUP_REQUIRED" && !isAdmin);
  const action =
    status === "COMING_SOON"
      ? "Coming soon"
      : status === "ADMIN_SETUP_REQUIRED"
        ? isAdmin
          ? "Fix setup"
          : "Temporarily unavailable"
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
            <StatusBadge row={readiness} />
          ) : (
            <Badge variant="secondary">Checking</Badge>
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
            Features depend on your account and the permissions approved by the provider.
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
            variant={status === "ADMIN_SETUP_REQUIRED" ? "outline" : "default"}
            onClick={onConnect}
            disabled={disabled}
          >
            {!readiness
              ? "Checking availability…"
              : connecting
                ? "Opening secure sign-in…"
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
            <p className="text-muted-foreground">Last verified</p>
            <p className="mt-1 font-medium">{humanTime(account.last_synced_at)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Last sync</p>
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
                Open <ExternalLink className="ml-1 size-3.5" />
              </a>
            </Button>
          )}
          {meta?.oauth && (
            <Button size="sm" variant="outline" onClick={onReconnect}>
              <RefreshCw className="mr-1 size-3.5" /> Reconnect
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={disconnecting}
            onClick={onDisconnect}
          >
            <Unplug className="mr-1 size-3.5" /> Disconnect
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
      className="flex items-center gap-3 rounded-xl border p-4 text-left transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
}: {
  label: string;
  value: number;
  tone: "good" | "warn" | "muted";
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
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
