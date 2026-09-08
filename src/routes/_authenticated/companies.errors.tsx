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
      toast.success("Updated");
      void qc.invalidateQueries({ queryKey: ["manager-integration-errors"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update"),
  });

  if (!isSuperAdmin) {
    return (
      <main className="grid flex-1 place-items-center p-6">
        <p className="text-sm text-muted-foreground">
          This area is only available to the Flas platform manager.
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
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1 h-7 gap-1 text-xs">
            <Link to="/companies">
              <ArrowLeft className="size-3.5" /> Companies
            </Link>
          </Button>
          <h1 className="text-xl font-bold tracking-tight">Errors &amp; issues</h1>
          <p className="text-sm text-muted-foreground">
            Everything customers hit — app crashes and failed requests on the left, provider
            failures on the right. Refreshes every minute.
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
          label="App error groups"
          value={groups.length}
          tone={worst > 0 ? "bad" : groups.length > 0 ? "warn" : "ok"}
          hint={worst > 0 ? `${worst} critical` : "distinct problems"}
        />
        <Stat
          icon={Users}
          label="People affected"
          value={groups.reduce((n, g) => n + g.affectedUsers, 0)}
          tone={groups.length > 0 ? "warn" : "ok"}
          hint="across all groups"
        />
        <Stat
          icon={Plug}
          label="Open provider errors"
          value={provider.length}
          tone={provider.length > 0 ? "warn" : "ok"}
          hint="unresolved"
        />
      </div>

      {app.data?.truncated && (
        <p className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
          More than {app.data.scanned} events in this window — the list below groups the most
          recent ones only. Narrow the range for an accurate picture.
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        {/* ── App errors ──────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bug className="size-4" /> App errors
              <Badge variant="secondary">{groups.length}</Badge>
            </CardTitle>
            <CardDescription>
              Browser crashes, failed server calls and blank screens, grouped and ordered by how
              many people hit them — not by raw count, so one user in a render loop cannot outrank
              a problem twenty customers share.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {app.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {app.error && (
              <p className="text-sm text-destructive">
                {app.error instanceof Error ? app.error.message : "Could not load errors"}
              </p>
            )}
            {!app.isLoading && groups.length === 0 && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="size-4 text-brand" /> No app errors in this window.
              </p>
            )}

            {groups.map((g) => {
              const id = `app:${g.fingerprint}`;
              const expanded = open === id;
              return (
                <div key={id} className="rounded-lg border p-3">
                  <button
                    type="button"
                    className="flex w-full items-start justify-between gap-3 text-left"
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
                          {g.affectedUsers} affected · {g.count}×
                        </span>
                      </span>
                      <span className="mt-1.5 block break-words text-sm font-medium">
                        {g.message.slice(0, 180)}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {g.companies.length > 0 ? g.companies.join(", ") : "no workspace"} · last{" "}
                        {new Date(g.lastSeen).toLocaleString()}
                      </span>
                    </span>
                    <ChevronDown
                      aria-hidden
                      className={`mt-1 size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
                    />
                  </button>

                  {expanded && (
                    <div className="mt-3 space-y-2 border-t pt-3 text-xs">
                      <Field label="Routes" value={g.routes.join(", ") || "—"} />
                      <Field label="Releases" value={g.releases.join(", ") || "—"} />
                      <Field
                        label="First seen"
                        value={new Date(g.firstSeen).toLocaleString()}
                      />
                      {g.sampleStack && (
                        <div>
                          <p className="mb-1 font-medium text-muted-foreground">Stack</p>
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
              <Plug className="size-4" /> Provider &amp; integration errors
              <Badge variant="secondary">{provider.length}</Badge>
            </CardTitle>
            <CardDescription>
              Meta, Google, TikTok and WhatsApp failures. Each already carries a likely cause and a
              recommended fix, so most can be answered without opening a log.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {integration.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!integration.isLoading && provider.length === 0 && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="size-4 text-brand" /> No open provider errors.
              </p>
            )}

            {provider.map((e) => {
              const id = `int:${e.id}`;
              const expanded = open === id;
              return (
                <div key={e.id} className="rounded-lg border p-3">
                  <button
                    type="button"
                    className="flex w-full items-start justify-between gap-3 text-left"
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
                            retryable
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {e.occurrence_count}×
                        </span>
                      </span>
                      <span className="mt-1.5 block break-words text-sm font-medium">
                        {e.friendly_title}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {e.company} · last {new Date(e.last_seen).toLocaleString()}
                      </span>
                    </span>
                    <ChevronDown
                      aria-hidden
                      className={`mt-1 size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
                    />
                  </button>

                  {expanded && (
                    <div className="mt-3 space-y-2 border-t pt-3 text-xs">
                      <Field label="What happened" value={e.friendly_message} />
                      {e.likely_cause && <Field label="Likely cause" value={e.likely_cause} />}
                      {e.recommended_fix && (
                        <Field label="Recommended fix" value={e.recommended_fix} />
                      )}
                      <Field
                        label="Provider"
                        value={[
                          e.operation,
                          e.http_status ? `HTTP ${e.http_status}` : null,
                          e.provider_code ? `code ${e.provider_code}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      />
                      {e.provider_message && (
                        <Field label="Raw message" value={e.provider_message} />
                      )}
                      <Button
                        size="sm"
                        variant={e.resolved_at ? "outline" : "default"}
                        className="mt-1 h-7 text-xs"
                        disabled={markResolved.isPending}
                        onClick={() =>
                          markResolved.mutate({ id: e.id, resolved: !e.resolved_at })
                        }
                      >
                        {e.resolved_at ? "Reopen" : "Mark resolved"}
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
