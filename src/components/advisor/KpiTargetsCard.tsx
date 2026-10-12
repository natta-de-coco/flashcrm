import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  generateKpiTargetsFromAdvisor,
  getKpiOverview,
  resolveKpiAlert,
  runKpiCheck,
  saveKpiTargets,
} from "@/lib/kpi.functions";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BellRing, Check, Gauge, RefreshCw, Save, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/hooks/useI18n";
import { hasMessage, type MessageKey } from "@/lib/i18n";

type Definition = {
  metric: string;
  label: string;
  unit: string;
  direction: "higher" | "lower";
  hint: string;
};

/** Advisor-set KPI targets with live readings and missed-target alerts. */
export function KpiTargetsCard() {
  const i18n = useI18n();
  // The metric list comes from the server in English; its name, unit and
  // explanation are looked up here by metric id so they follow the language.
  const metricText = (d: Definition, part: "label" | "hint" | "unit") => {
    const key = `kpiTargetsCard.metric.${d.metric}.${part}`;
    return hasMessage(key) ? i18n.t(key as MessageKey) : d[part];
  };
  const qc = useQueryClient();
  const load = useServerFn(getKpiOverview);
  const save = useServerFn(saveKpiTargets);
  const generate = useServerFn(generateKpiTargetsFromAdvisor);
  const check = useServerFn(runKpiCheck);
  const resolve = useServerFn(resolveKpiAlert);

  const overview = useQuery({
    queryKey: ["kpi_overview"],
    queryFn: () => load({}),
    refetchInterval: 120_000,
  });

  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    const rows = overview.data?.targets ?? [];
    if (rows.length === 0) return;
    setDrafts((prev) => {
      const next = { ...prev };
      for (const t of rows as Array<{ metric: string; target_value: number }>) {
        if (next[t.metric] === undefined) next[t.metric] = String(t.target_value);
      }
      return next;
    });
  }, [overview.data]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["kpi_overview"] });
  };

  const generateTargets = useMutation({
    mutationFn: () => generate({}),
    onSuccess: (res) => {
      setDrafts({});
      toast.success(
        res.saved > 0
          ? i18n.t("kpiTargetsCard.advisorSetKpiTargets", { saved: res.saved })
          : i18n.t("kpiTargetsCard.theAdvisorCouldNotSet"),
      );
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveTargets = useMutation({
    mutationFn: () => {
      const rows = (overview.data?.definitions ?? [])
        .map((d: Definition) => ({ d, raw: drafts[d.metric] }))
        .filter((r) => r.raw !== undefined && r.raw !== "" && Number.isFinite(Number(r.raw)))
        .map((r) => ({
          metric: r.d.metric as never,
          target_value: Number(r.raw),
          note: null,
          active: true,
        }));
      if (rows.length === 0) throw new Error("Enter at least one target value");
      return save({ data: { targets: rows, source: "manual" } });
    },
    onSuccess: () => {
      toast.success(i18n.t("kpiTargetsCard.kpiTargetsSaved"));
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runCheck = useMutation({
    mutationFn: () => check({}),
    onSuccess: (res) => {
      toast[res.newAlerts > 0 ? "warning" : "success"](
        res.newAlerts > 0
          ? `${res.newAlerts} target${res.newAlerts === 1 ? "" : "s"} missed — alerts raised`
          : "All targets on track",
      );
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clearAlert = useMutation({
    mutationFn: (id: string) => resolve({ data: { id } }),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const definitions = (overview.data?.definitions ?? []) as Definition[];
  const measurements = (overview.data?.measurements ?? []) as Array<
    Definition & { value: number | null }
  >;
  const targets = (overview.data?.targets ?? []) as Array<{
    id: string;
    metric: string;
    target_value: number;
    source: string;
    note: string | null;
  }>;
  const alerts = (overview.data?.alerts ?? []) as Array<{
    id: string;
    label: string;
    message: string;
    severity: string;
    resolved: boolean;
    created_at: string;
  }>;
  const openAlerts = alerts.filter((a) => !a.resolved);

  const targetByMetric = new Map(targets.map((t) => [t.metric, t]));

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="size-4 text-brand" /> {i18n.t("kpiTargetsCard.kpiTargetsAlerts")}
          </CardTitle>
          <CardDescription>
            {i18n.t("kpiTargetsCard.responseTimeConversionLeadVelocity")}
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => generateTargets.mutate()}
            disabled={generateTargets.isPending}
          >
            <Sparkles className="size-4" />
            {generateTargets.isPending
              ? i18n.t("kpiTargetsCard.setting")
              : i18n.t("kpiTargetsCard.letAdvisorSetTargets")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => runCheck.mutate()}
            disabled={runCheck.isPending || targets.length === 0}
          >
            <RefreshCw className={cn("size-4", runCheck.isPending && "animate-spin")} />{" "}
            {i18n.t("kpiTargetsCard.checkNow")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        {overview.isLoading ? (
          <>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </>
        ) : (
          <>
            {openAlerts.length > 0 ? (
              <div className="grid gap-2">
                {openAlerts.map((a) => (
                  <div
                    key={a.id}
                    className={cn(
                      "flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3",
                      a.severity === "critical"
                        ? "border-destructive/40 bg-destructive/10"
                        : "border-amber-500/40 bg-amber-500/10",
                    )}
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      <BellRing className="mt-0.5 size-4 shrink-0" />
                      <div className="min-w-0">
                        <p className="font-medium">{a.label}</p>
                        <p className="text-xs text-muted-foreground">{a.message}</p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => clearAlert.mutate(a.id)}
                      disabled={clearAlert.isPending}
                    >
                      <Check className="size-4" /> {i18n.t("kpiTargetsCard.resolve")}
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="grid gap-2">
              {definitions.map((d) => {
                const measured = measurements.find((m) => m.metric === d.metric)?.value ?? null;
                const target = targetByMetric.get(d.metric);
                const missed =
                  target != null && measured != null
                    ? d.direction === "lower"
                      ? measured > Number(target.target_value)
                      : measured < Number(target.target_value)
                    : false;
                return (
                  <div
                    key={d.metric}
                    className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{metricText(d, "label")}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {d.direction === "lower"
                            ? i18n.t("kpiTargetsCard.lowerIsBetter")
                            : i18n.t("kpiTargetsCard.higherIsBetter")}
                        </Badge>
                        {target?.source === "advisor" ? (
                          <Badge className="bg-brand text-brand-foreground text-[10px]">
                            {i18n.t("kpiTargetsCard.advisor")}
                          </Badge>
                        ) : null}
                        {missed ? (
                          <Badge variant="destructive" className="text-[10px]">
                            {i18n.t("kpiTargetsCard.offTarget")}
                          </Badge>
                        ) : target && measured != null ? (
                          <Badge variant="secondary" className="text-[10px]">
                            {i18n.t("kpiTargetsCard.onTrack")}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {i18n.tr("kpiTargetsCard.now", {
                          span: (
                            <span className="font-medium text-foreground">
                              {measured != null
                                ? `${measured}${d.unit === "%" ? "" : " "}${metricText(d, "unit")}`
                                : i18n.t("kpiTargetsCard.notEnoughData")}
                            </span>
                          ),
                          value: target?.note ?? metricText(d, "hint"),
                        })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 sm:justify-end">
                      <Input
                        className="h-9 w-28"
                        inputMode="decimal"
                        placeholder={i18n.t("kpiTargetsCard.target")}
                        value={drafts[d.metric] ?? ""}
                        onChange={(e) => setDrafts({ ...drafts, [d.metric]: e.target.value })}
                      />
                      <span className="w-16 text-xs text-muted-foreground">
                        {metricText(d, "unit")}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <Button
              variant="secondary"
              className="justify-self-start"
              onClick={() => saveTargets.mutate()}
              disabled={saveTargets.isPending}
            >
              <Save className="size-4" /> {i18n.t("kpiTargetsCard.saveTargets")}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
