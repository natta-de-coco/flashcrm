import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import {
  listErrorGroups,
  listIntegrationErrors,
  resolveIntegrationError,
} from "@/lib/errors.functions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowLeft,
  Bug,
  CheckCircle2,
  ChevronDown,
  Plug,
  RefreshCw,
  Users,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { formatMomentUnambiguous } from "@/lib/locale";
import { useI18n } from "@/hooks/useI18n";

export const Route = createFileRoute("/_authenticated/companies/errors")({
  head: () => ({
    meta: [{ title: "Errors — Flas Manager" }, { name: "robots", content: "noindex" }],
  }),
  component: ErrorsPage,
});

const SEVERITY: Record<string, string> = {
  critical: "bg-destructive text-destructive-foreground",
  system_failure: "bg-destructive text-destructive-foreground",
  action_required: "bg-amber-500 text-white",
  error: "bg-destructive/85 text-destructive-foreground",
  warning: "bg-amber-500 text-white",
  info: "bg-muted text-muted-foreground",
};

const WINDOWS = [1, 7, 30] as const;

/**
 * What is breaking for customers, in one place.
 *
 * error_events and integration_errors have both been collecting for a while
 * with nothing reading them, so this is the first screen that shows either.
 * They are kept as separate lists on purpose: a provider error is usually one
 * customer's credentials expiring and is fixed by telling them, while an app
 * error is usually our bug and is fixed by shipping. Merging them into one
 * feed would blur the only distinction that decides what to do next.
 */
function ErrorsPage() {
  const { t, tr } = useI18n();
  const { isSuperAdmin } = useAuth();
  const qc = useQueryClient();
  const [days, setDays] = useState<number>(7);
  const [open, setOpen] = useState<string | null>(null);

  const fetchGroups = useServerFn(listErrorGroups);
  const fetchIntegration = useServerFn(listIntegrationErrors);
  const resolve = useServerFn(resolveIntegrationError);

  const app = useQuery({
    queryKey: ["manager-errors", days],
    queryFn: () => fetchGroups({ data: { days } }),
    enabled: isSuperAdmin,
    refetchInterval: 60_000,
  });

  const integration = useQuery({
    queryKey: ["manager-integration-errors", days],
    queryFn: () => fetchIntegration({ data: { days } }),
    enabled: isSuperAdmin,
    refetchInterval: 60_000,
  });

  const markResolved = useMutation({
    mutationFn: (v: { id: string; resolved: boolean }) => resolve({ data: v }),
    onSuccess: () => {
      toast.success(t("companiesErrors.updated"));
      void qc.invalidateQueries({ queryKey: ["manager-integration-errors"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : t("companiesErrors.couldNotUpdate")),
  });

  if (!isSuperAdmin) {
    return (
      <main className="grid flex-1 place-items-center p-6">
        <p className="text-sm text-muted-foreground">
          {t("companiesErrors.thisAreaIsOnlyAvailable")}
        </p>
      </main>
    );
  }

  const groups = app.data?.groups ?? [];
  const provider = integration.data ?? [];
  const worst = groups.filter((g) => g.severity === "critical").length;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ms-2 mb-1 h-7 gap-1 text-xs">
            <Link to="/companies">
              <ArrowLeft className="size-3.5" /> {t("companiesErrors.companies")}
            </Link>
          </Button>
          <h1 className="text-xl font-bold tracking-tight">{t("companiesErrors.errorsIssues")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("companiesErrors.everythingCustomersHitAppCrashes")}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {WINDOWS.map((d) => (
            <Button
              key={d}
              size="sm"
              variant={days === d ? "default" : "outline"}
              onClick={() => setDays(d)}
            >
              {d === 1 ? "24h" : `${d}d`}
            </Button>
          ))}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void app.refetch();
              void integration.refetch();
            }}
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Headline counts */}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat
          icon={Bug}
          label={t("companiesErrors.appErrorGroups")}
          value={groups.length}
          tone={worst > 0 ? "bad" : groups.length > 0 ? "warn" : "ok"}
          hint={
            worst > 0
              ? t("companiesErrors.critical", { worst: worst })
              : t("companiesErrors.distinctProblems")
          }
        />
        <Stat
          icon={Users}
          label={t("companiesErrors.peopleAffected")}
          value={groups.reduce((n, g) => n + g.affectedUsers, 0)}
          tone={groups.length > 0 ? "warn" : "ok"}
          hint={t("companiesErrors.acrossAllGroups")}
        />
        <Stat
          icon={Plug}
          label={t("companiesErrors.openProviderErrors")}
          value={provider.length}
          tone={provider.length > 0 ? "warn" : "ok"}
          hint={t("companiesErrors.unresolved")}
        />
      </div>

      {app.data?.truncated && (
        <p className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
          {tr("companiesErrors.moreThanEventsInThis", { scanned: app.data.scanned })}
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        {/* ── App errors ──────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bug className="size-4" />{" "}
              {tr("companiesErrors.appErrors", {
                badge: <Badge variant="secondary">{groups.length}</Badge>,
              })}
            </CardTitle>
            <CardDescription>
              {t("companiesErrors.browserCrashesFailedServerCalls")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {app.isLoading && (
              <p className="text-sm text-muted-foreground">{t("companiesErrors.loading")}</p>
            )}
            {app.error && (
              <p className="text-sm text-destructive">
                {app.error instanceof Error
                  ? app.error.message
                  : t("companiesErrors.couldNotLoadErrors")}
              </p>
            )}
            {!app.isLoading && groups.length === 0 && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="size-4 text-brand" />{" "}
                {t("companiesErrors.noAppErrorsInThis")}
              </p>
            )}

            {groups.map((g) => {
              const id = `app:${g.fingerprint}`;
              const expanded = open === id;
              return (
                <div key={id} className="rounded-lg border p-3">
                  <button
                    type="button"
                    className="flex w-full items-start justify-between gap-3 text-start"
                    onClick={() => setOpen(expanded ? null : id)}
                    aria-expanded={expanded}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Badge className={SEVERITY[g.severity] ?? SEVERITY["error"]}>
                          {g.severity}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {g.kind}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {tr("companiesErrors.affected", {
                            affectedUsers: g.affectedUsers,
                            count: g.count,
                          })}
                        </span>
                      </span>
                      <span className="mt-1.5 block break-words text-sm font-medium">
                        {g.message.slice(0, 180)}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {tr("companiesErrors.last", {
                          value:
                            g.companies.length > 0
                              ? g.companies.join(", ")
                              : t("companiesErrors.noWorkspace"),
                          formatMomentUnambiguous: formatMomentUnambiguous(g.lastSeen),
                        })}
                      </span>
                    </span>
                    <ChevronDown
                      aria-hidden
                      className={`mt-1 size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
                    />
                  </button>

                  {expanded && (
                    <div className="mt-3 space-y-2 border-t pt-3 text-xs">
                      <Field
                        label={t("companiesErrors.routes")}
                        value={g.routes.join(", ") || "—"}
                      />
                      <Field
                        label={t("companiesErrors.releases")}
                        value={g.releases.join(", ") || "—"}
                      />
                      <Field
                        label={t("companiesErrors.firstSeen")}
                        value={formatMomentUnambiguous(g.firstSeen)}
                      />
                      {g.sampleStack && (
                        <div>
                          <p className="mb-1 font-medium text-muted-foreground">
                            {t("companiesErrors.stack")}
                          </p>
                          <pre className="max-h-56 overflow-auto rounded-md bg-muted p-2 text-[11px] leading-relaxed">
                            {g.sampleStack}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* ── Provider errors ─────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Plug className="size-4" />{" "}
              {tr("companiesErrors.providerIntegrationErrors", {
                badge: <Badge variant="secondary">{provider.length}</Badge>,
              })}
            </CardTitle>
            <CardDescription>{t("companiesErrors.metaGoogleTiktokAndWhatsapp")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {integration.isLoading && (
              <p className="text-sm text-muted-foreground">{t("companiesErrors.loading")}</p>
            )}
            {!integration.isLoading && provider.length === 0 && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="size-4 text-brand" />{" "}
                {t("companiesErrors.noOpenProviderErrors")}
              </p>
            )}

            {provider.map((e) => {
              const id = `int:${e.id}`;
              const expanded = open === id;
              return (
                <div key={e.id} className="rounded-lg border p-3">
                  <button
                    type="button"
                    className="flex w-full items-start justify-between gap-3 text-start"
                    onClick={() => setOpen(expanded ? null : id)}
                    aria-expanded={expanded}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Badge className={SEVERITY[e.severity] ?? SEVERITY["warning"]}>
                          {e.severity.replace(/_/g, " ")}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] capitalize">
                          {e.platform}
                        </Badge>
                        {e.retryable && (
                          <Badge variant="secondary" className="text-[10px]">
                            {t("companiesErrors.retryable")}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">{e.occurrence_count}×</span>
                      </span>
                      <span className="mt-1.5 block break-words text-sm font-medium">
                        {e.friendly_title}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {tr("companiesErrors.last2", {
                          company: e.company,
                          formatMomentUnambiguous: formatMomentUnambiguous(e.last_seen),
                        })}
                      </span>
                    </span>
                    <ChevronDown
                      aria-hidden
                      className={`mt-1 size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
                    />
                  </button>

                  {expanded && (
                    <div className="mt-3 space-y-2 border-t pt-3 text-xs">
                      <Field label={t("companiesErrors.whatHappened")} value={e.friendly_message} />
                      {e.likely_cause && (
                        <Field label={t("companiesErrors.likelyCause")} value={e.likely_cause} />
                      )}
                      {e.recommended_fix && (
                        <Field
                          label={t("companiesErrors.recommendedFix")}
                          value={e.recommended_fix}
                        />
                      )}
                      <Field
                        label={t("companiesErrors.provider")}
                        value={[
                          e.operation,
                          e.http_status ? `HTTP ${e.http_status}` : null,
                          e.provider_code ? `code ${e.provider_code}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      />
                      {e.provider_message && (
                        <Field label={t("companiesErrors.rawMessage")} value={e.provider_message} />
                      )}
                      <Button
                        size="sm"
                        variant={e.resolved_at ? "outline" : "default"}
                        className="mt-1 h-7 text-xs"
                        disabled={markResolved.isPending}
                        onClick={() => markResolved.mutate({ id: e.id, resolved: !e.resolved_at })}
                      >
                        {e.resolved_at
                          ? t("companiesErrors.reopen")
                          : t("companiesErrors.markResolved")}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: typeof Bug;
  label: string;
  value: number;
  hint: string;
  tone: "ok" | "warn" | "bad";
}) {
  const ring =
    tone === "bad" ? "border-destructive/40" : tone === "warn" ? "border-amber-500/40" : undefined;
  return (
    <div className={`rounded-xl border p-4 ${ring ?? ""}`}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {tone === "bad" ? (
          <AlertTriangle className="size-3.5 text-destructive" />
        ) : (
          <Icon className="size-3.5" />
        )}
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-medium text-muted-foreground">{label}</p>
      <p className="break-words">{value}</p>
    </div>
  );
}
