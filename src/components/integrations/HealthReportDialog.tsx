// Integration Health Report: one row per connected account (and one per platform with none), each
// with a plain state, the reason, and ONE next step chosen from the evidence on the account. A check
// asks the platform; the screen only ever says "Connected" for what the server saved as verified.
// Exportable as PDF or CSV.
//
// Technical details (permission names, the platform's own answers, the stage a check stopped at)
// reach only Flas staff: the server sends them to nobody else, and this screen shows them only to a
// super admin.
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  encryptStoredCredentials,
  getIntegrationHealthReport,
  retryConnections,
} from "@/lib/connections.functions";
import { CONNECTOR_COUNTS, NON_OAUTH_CONNECTORS } from "@/lib/social-connector-definitions";
import {
  downloadHealthReportCsv,
  downloadHealthReportPdf,
  needsAttention,
} from "@/lib/integration-health";
import type { HealthRow } from "@/lib/integration-health";
import {
  ONLY_ADMIN_MESSAGE,
  describeAction,
  describeChecks,
  describeFix,
  describeLabel,
  describeNotProven,
  describeReason,
  type Described,
  type Format,
} from "@/lib/integration-health-text";

/**
 * Counts come from the connector registry, so the grid and this dialog cannot
 * disagree. The catalogue and the health report used to report different
 * totals with no explanation of the gap.
 */
const KEYED_CONNECTORS = NON_OAUTH_CONNECTORS;
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, FileDown, RefreshCw, Stethoscope } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { credentialsNote } from "@/lib/credentials-note";
import { toast } from "sonner";
import { useI18n } from "@/hooks/useI18n";

const TONE: Record<string, string> = {
  connected: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  unverified: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  provider_unavailable: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  needs_verification: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  pending_review: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  expired: "bg-red-500/10 text-red-600 dark:text-red-400",
  failing: "bg-red-500/10 text-red-600 dark:text-red-400",
  not_connected: "bg-muted text-muted-foreground",
};

export function HealthReportDialog({ trigger }: { trigger?: ReactNode }) {
  const { t, tr, language } = useI18n();
  const [open, setOpen] = useState(false);
  const { isSuperAdmin } = useAuth();
  const qc = useQueryClient();
  const check = useServerFn(retryConnections);
  const format: Format = { time: (iso) => new Date(iso).toLocaleString(language) };

  const report = useQuery({
    queryKey: ["integration-health"],
    queryFn: () => getIntegrationHealthReport(),
    enabled: open,
  });

  const encrypt = useServerFn(encryptStoredCredentials);
  const sealing = useMutation({
    mutationFn: () => encrypt(),
    onSuccess: (result) => {
      toast.success(
        result.sealedNow
          ? t("healthReportDialog.encryptedStoredCredentialS", { sealedNow: result.sealedNow })
          : t("healthReportDialog.nothingNeededEncrypting"),
      );
      void qc.invalidateQueries({ queryKey: ["integration-health"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // One account (its own id) or, with no id, every account that needs a check. The message after it
  // comes from what each check really did, never from "nothing to retry".
  const runCheck = useMutation({
    mutationFn: async (accountId?: string) => check({ data: accountId ? { accountId } : {} }),
    onSuccess: (result) => {
      const { kind, parts } = describeChecks(result.results ?? [], format);
      toast[kind](parts.map((part) => t(part.key, part.values)).join(" "));
      void qc.invalidateQueries({ queryKey: ["integration-health"] });
      void qc.invalidateQueries({ queryKey: ["connections"] });
    },
    onError: (e: Error) =>
      toast.error(
        e.message === ONLY_ADMIN_MESSAGE ? t("healthReportDialog.onlyCompanyAdmin") : e.message,
      ),
  });

  const data = report.data;
  const attention = (data?.rows ?? []).filter((r) => needsAttention(r.state));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="gap-1.5">
            <Stethoscope className="size-4" /> {t("healthReportDialog.healthReport")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("healthReportDialog.integrationHealthReport")}</DialogTitle>
          <DialogDescription>
            {/* This said "every platform" while covering only the OAuth ones,
                so the totals here and on the connector grid disagreed and
                neither said why. Both numbers are derived from the catalogue
                now, so they cannot drift apart again. */}
            {tr("healthReportDialog.statusLastErrorMissingPermissions", {
              oauthPlatforms: CONNECTOR_COUNTS.oauthPlatforms,
              keyedOrPlugin: CONNECTOR_COUNTS.keyedOrPlugin,
              join: KEYED_CONNECTORS.map((c) => c.displayName).join(", "),
            })}
          </DialogDescription>
          {/* WhatsApp numbers are not read by this report: their health is on Alerts & health. */}
          <p className="text-xs text-muted-foreground">
            <Link
              to="/monitoring"
              className="underline underline-offset-2"
              onClick={() => setOpen(false)}
            >
              {t("healthReportDialog.whatsappElsewhere")}
            </Link>
          </p>
        </DialogHeader>

        {report.isLoading && (
          <div className="grid gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        )}

        {data && (
          <>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge className={TONE["connected"]}>
                {tr("healthReportDialog.connected", { connected: data.connected })}
              </Badge>
              <Badge className={TONE["failing"]}>
                {tr("healthReportDialog.needAttention", { needsattention: data.needs_attention })}
              </Badge>
              <Badge className={TONE["not_connected"]}>
                {tr("healthReportDialog.notConnected", { notconnected: data.not_connected })}
              </Badge>
            </div>

            {data.credentials ? (
              <p className="text-xs text-muted-foreground">
                {credentialsNote(data.credentials, isSuperAdmin)}
                {data.credentials.configured && data.credentials.plaintext > 0 ? (
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto px-1 text-xs"
                    disabled={sealing.isPending}
                    onClick={() => sealing.mutate()}
                  >
                    {sealing.isPending
                      ? t("healthReportDialog.encrypting")
                      : t("healthReportDialog.encryptNow")}
                  </Button>
                ) : null}
              </p>
            ) : null}

            <ScrollArea className="max-h-[52vh] pe-3">
              <div className="grid gap-2">
                {(attention.length > 0 ? attention : data.rows).map((row) => (
                  <HealthRowCard
                    key={row.account_id ?? row.platform}
                    row={row}
                    format={format}
                    staff={isSuperAdmin}
                    // Each row checks its own account: the old row button ran the whole group, and
                    // reported "nothing to retry" for an account that was merely unverified.
                    checking={runCheck.isPending && runCheck.variables === row.account_id}
                    busy={runCheck.isPending}
                    onCheck={(accountId) => runCheck.mutate(accountId)}
                    onLeave={() => setOpen(false)}
                  />
                ))}
              </div>

              {data.retries.length > 0 && (
                <div className="mt-4 grid gap-1.5">
                  <p className="text-sm font-semibold">{t("healthReportDialog.recentChecks")}</p>
                  {data.retries.slice(0, 8).map((r) => (
                    <p key={r.id} className="text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleString(language)} ·{" "}
                      {r.platform.replace(/_/g, " ")}
                      {r.reason ? ` — ${r.reason}` : ""}
                    </p>
                  ))}
                </div>
              )}
            </ScrollArea>

            <DialogFooter className="flex-wrap gap-2 sm:justify-between">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                // Nothing to check when no account needs attention. The server handles that case
                // gracefully, so this only saves a pointless round trip -- but a button that looks
                // actionable and does nothing is its own small lie.
                disabled={runCheck.isPending || attention.length === 0}
                onClick={() => runCheck.mutate(undefined)}
              >
                <RefreshCw className={`size-4 ${runCheck.isPending ? "animate-spin" : ""}`} />
                {t("healthReportDialog.checkAttention")}
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => downloadHealthReportCsv(data)}
                >
                  <FileDown className="size-4" /> CSV
                </Button>
                <Button size="sm" className="gap-1.5" onClick={() => downloadHealthReportPdf(data)}>
                  <FileDown className="size-4" /> PDF
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function HealthRowCard({
  row,
  format,
  staff,
  checking,
  busy,
  onCheck,
  onLeave,
}: {
  row: HealthRow;
  format: Format;
  staff: boolean;
  checking: boolean;
  busy: boolean;
  onCheck: (accountId: string) => void;
  onLeave: () => void;
}) {
  const { t, tr } = useI18n();
  const good = row.state === "connected";
  const say = (described: Described | null, fallback: string) =>
    described ? t(described.key, described.values) : fallback;

  const labelKey = describeLabel(row);
  const reason = say(describeReason(row, format), row.reason);
  const fix = good ? null : say(describeFix(row, format), row.next_step);
  const notProven = describeNotProven(row);
  const action = describeAction(row);
  const diagnostics = staff ? row.diagnostics : null;

  const button = (() => {
    if (!action) return null;
    const label = t(action.key, action.values);
    const className = "mt-2 h-7 gap-1 px-2 text-xs";
    switch (row.action) {
      case "verify":
      case "retry":
        return (
          <Button
            variant="ghost"
            size="sm"
            className={className}
            disabled={busy || !row.account_id}
            onClick={() => row.account_id && onCheck(row.account_id)}
          >
            <RefreshCw className={`size-3.5 ${checking ? "animate-spin" : ""}`} /> {label}
          </Button>
        );
      case "coming_soon":
        return (
          <Button variant="ghost" size="sm" className={className} disabled>
            {label}
          </Button>
        );
      case "choose_account":
        // The Connect accounts page opens straight on this account's picker.
        return (
          <Button asChild variant="ghost" size="sm" className={className}>
            <Link
              to="/connect"
              search={{ connected: row.platform, select_target: row.account_id ?? "" }}
              onClick={onLeave}
            >
              {label}
            </Link>
          </Button>
        );
      default:
        // connect and reconnect: the guided sign-in is on the Connect accounts page.
        return (
          <Button asChild variant="ghost" size="sm" className={className}>
            <Link to="/connect" search={{}} onClick={onLeave}>
              {label}
            </Link>
          </Button>
        );
    }
  })();

  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {good ? (
            <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
          ) : (
            <AlertTriangle className="size-4 shrink-0 text-amber-500" />
          )}
          <span className="truncate text-sm font-semibold">{row.platform_name}</span>
          {row.account_label && (
            <span className="truncate text-xs text-muted-foreground">{row.account_label}</span>
          )}
        </div>
        <Badge className={`${TONE[row.state] ?? TONE["not_connected"]} text-[11px]`}>
          {labelKey ? t(labelKey) : row.state_label}
        </Badge>
      </div>
      <p className="mt-2 break-words text-xs text-muted-foreground">{reason}</p>
      {notProven && (
        <p className="mt-1 break-words text-xs text-muted-foreground">
          {t(notProven.key, notProven.values)}
        </p>
      )}
      {row.last_error && (
        <p className="mt-1 break-words text-xs text-red-600 dark:text-red-400">
          {tr("healthReportDialog.lastError", { lasterror: row.last_error })}
        </p>
      )}
      {row.missing_permissions.length > 0 && (
        <p className="mt-1 break-words text-xs text-amber-600 dark:text-amber-400">
          {tr("healthReportDialog.missingPermissions", {
            join: row.missing_permissions.join(", "),
          })}
        </p>
      )}
      {fix && (
        <p className="mt-1 break-words text-xs">
          <span className="font-medium">{t("healthReportDialog.nextStep")}</span> {fix}
        </p>
      )}
      {button}
      {diagnostics && (
        <div className="mt-2 grid gap-0.5 rounded-md bg-muted/50 p-2 text-[11px] text-muted-foreground">
          {diagnostics.correlation_id && (
            <span>{t("healthReportDialog.diagReference", { id: diagnostics.correlation_id })}</span>
          )}
          {diagnostics.stage && (
            <span>{t("healthReportDialog.diagStage", { stage: diagnostics.stage })}</span>
          )}
          {diagnostics.http_status !== null && (
            <span>{t("healthReportDialog.diagStatus", { status: diagnostics.http_status })}</span>
          )}
          {diagnostics.last_attempt_at && (
            <span>
              {t("healthReportDialog.diagLastCheck", {
                time: format.time(diagnostics.last_attempt_at),
              })}
            </span>
          )}
          <span>
            {t(
              diagnostics.evidence_storage === "ready"
                ? "healthReportDialog.diagStorageReady"
                : diagnostics.evidence_storage === "unreadable"
                  ? "healthReportDialog.diagStorageUnreadable"
                  : "healthReportDialog.diagStorageMissing",
            )}
          </span>
          {diagnostics.scopes_missing.length > 0 && (
            <span className="break-all">
              {t("healthReportDialog.diagScopes", {
                scopes: diagnostics.scopes_missing.join(", "),
              })}
            </span>
          )}
          {diagnostics.provider_message && (
            <span className="break-words">
              {t("healthReportDialog.diagMessage", { message: diagnostics.provider_message })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
