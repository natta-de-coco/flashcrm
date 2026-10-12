import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteCampaignPlan,
  generateCampaignPlan,
  getCampaignIntel,
  listCampaignPlans,
} from "@/lib/campaign-planner.functions";
import type { CampaignPlan } from "@/lib/campaign-intel.server";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Copy,
  Globe2,
  History,
  Loader2,
  MapPin,
  MessageSquareText,
  Radar,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  Users,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/hooks/useI18n";

export const Route = createFileRoute("/_authenticated/campaign-planner")({
  head: () => ({
    meta: [
      { title: "Campaign Planner — Flas CRM" },
      {
        name: "description",
        content:
          "AI-grounded campaign targeting: who to reach, which channel to use, and what to say — based on your real audience and channel data.",
      },
      { property: "og:title", content: "Campaign Planner — Flas CRM" },
      {
        property: "og:description",
        content:
          "Targeting recommendations grounded in your real audience segments and channel performance.",
      },
    ],
  }),
  component: CampaignPlannerPage,
});

type SavedPlanRow = {
  id: string;
  goal: string;
  product: string | null;
  budget_note: string | null;
  plan: CampaignPlan;
  created_at: string;
};

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Sparkles;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-4 text-brand" /> {title}
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">{children}</CardContent>
    </Card>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function PlanView({ plan }: { plan: CampaignPlan }) {
  const { t } = useI18n();
  function copyMessage() {
    void navigator.clipboard.writeText(plan.draftOpeningMessage);
    toast.success(t("campaignPlanner.draftMessageCopied"));
  }

  return (
    <div className="grid gap-4">
      {plan.summary && <p className="text-sm leading-relaxed">{plan.summary}</p>}

      {plan.targetSegments.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Users className="size-3.5" /> {t("campaignPlanner.targetSegments")}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {plan.targetSegments.map((s, i) => (
              <div key={i} className="rounded-lg border p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{s.name}</span>
                  <Badge variant="outline">{s.estimatedSize.toLocaleString()}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{s.why}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {plan.recommendedChannels.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Radar className="size-3.5" /> {t("campaignPlanner.recommendedChannels")}
          </p>
          <div className="grid gap-2">
            {plan.recommendedChannels.map((c, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg border p-2.5">
                <Badge
                  className="capitalize"
                  variant={c.priority === "primary" ? "default" : "outline"}
                >
                  {c.priority}
                </Badge>
                <div className="min-w-0">
                  <span className="text-sm font-semibold capitalize">{c.platform}</span>
                  <p className="text-xs text-muted-foreground">{c.rationale}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {plan.geographicFocus.length > 0 ? (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <MapPin className="size-3.5" /> {t("campaignPlanner.geographicFocus")}
          </p>
          <div className="grid gap-2">
            {plan.geographicFocus.map((g, i) => (
              <div key={i} className="rounded-lg border p-2.5">
                <span className="text-sm font-semibold">{g.area}</span>
                <p className="text-xs text-muted-foreground">{g.why}</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t("campaignPlanner.noUsableGeographicSignalYet")}
        </p>
      )}

      {plan.timing && (
        <div className="rounded-lg border p-2.5">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("campaignPlanner.timing")}
          </p>
          <p className="text-sm">{plan.timing}</p>
        </div>
      )}

      {plan.messagingAngle && (
        <div className="rounded-lg border p-2.5">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("campaignPlanner.messagingAngle")}
          </p>
          <p className="text-sm">{plan.messagingAngle}</p>
        </div>
      )}

      {plan.draftOpeningMessage && (
        <div className="rounded-lg border bg-muted/40 p-2.5">
          <div className="mb-1 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <MessageSquareText className="size-3.5" /> {t("campaignPlanner.draftOpeningMessage")}
            </p>
            <Button size="sm" variant="ghost" onClick={copyMessage}>
              <Copy className="size-3.5" />
            </Button>
          </div>
          <p className="whitespace-pre-wrap text-sm">{plan.draftOpeningMessage}</p>
        </div>
      )}

      {plan.risksOrGaps.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("campaignPlanner.risksDataGaps")}
          </p>
          <ul className="list-disc space-y-1 ps-4 text-xs text-muted-foreground">
            {plan.risksOrGaps.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CampaignPlannerPage() {
  const { t, tr } = useI18n();
  const qc = useQueryClient();
  const [goal, setGoal] = useState("");
  const [product, setProduct] = useState("");
  const [budgetNote, setBudgetNote] = useState("");
  const [latestPlan, setLatestPlan] = useState<CampaignPlan | null>(null);

  const generate = useServerFn(generateCampaignPlan);
  const listPlans = useServerFn(listCampaignPlans);
  const getIntel = useServerFn(getCampaignIntel);
  const removePlan = useServerFn(deleteCampaignPlan);

  const intel = useQuery({
    queryKey: ["campaign-intel"],
    queryFn: () => getIntel(),
  });

  const plans = useQuery({
    queryKey: ["campaign-plans"],
    queryFn: () => listPlans() as Promise<SavedPlanRow[]>,
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!goal.trim()) throw new Error("Describe what this campaign is for first.");
      return generate({
        data: {
          goal: goal.trim(),
          ...(product.trim() ? { product: product.trim() } : {}),
          ...(budgetNote.trim() ? { budgetNote: budgetNote.trim() } : {}),
        },
      });
    },
    onSuccess: (res) => {
      setLatestPlan(res.plan);
      toast.success(t("campaignPlanner.campaignPlanReady"));
      void qc.invalidateQueries({ queryKey: ["campaign-plans"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => removePlan({ data: { id } }),
    onSuccess: () => {
      toast.success(t("campaignPlanner.planRemoved"));
      void qc.invalidateQueries({ queryKey: ["campaign-plans"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const segments = intel.data?.segments;
  const channels = intel.data?.channels ?? [];

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-6">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Target className="size-6 text-brand" /> {t("campaignPlanner.campaignPlanner")}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {t("campaignPlanner.describeWhatYouRePromoting")}
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid gap-4">
          <Section
            icon={Sparkles}
            title={t("campaignPlanner.newCampaign")}
            description={t("campaignPlanner.oneOrTwoSentencesIs")}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="goal">{t("campaignPlanner.campaignGoal")}</Label>
              <Textarea
                id="goal"
                rows={3}
                placeholder={t("campaignPlanner.eGGet50More")}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="product">{t("campaignPlanner.productServiceOptional")}</Label>
                <Input
                  id="product"
                  placeholder={t("campaignPlanner.eGWeekendDetailingPackage")}
                  value={product}
                  onChange={(e) => setProduct(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="budget">{t("campaignPlanner.budgetConstraintsOptional")}</Label>
                <Input
                  id="budget"
                  placeholder={t("campaignPlanner.eGAed2000")}
                  value={budgetNote}
                  onChange={(e) => setBudgetNote(e.target.value)}
                />
              </div>
            </div>
            <Button
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending || !goal.trim()}
              className="w-fit"
            >
              {generateMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              {t("campaignPlanner.generatePlan")}
            </Button>
          </Section>

          {generateMutation.isPending && (
            <Card>
              <CardContent className="grid gap-2 p-4">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
              </CardContent>
            </Card>
          )}

          {latestPlan && !generateMutation.isPending && (
            <Section icon={TrendingUp} title={t("campaignPlanner.latestPlan")}>
              <PlanView plan={latestPlan} />
            </Section>
          )}

          {(plans.data ?? []).length > 0 && (
            <Section icon={History} title={t("campaignPlanner.pastPlans")}>
              <div className="grid gap-2">
                {(plans.data ?? []).map((row) => (
                  <details key={row.id} className="rounded-lg border p-2.5">
                    <summary className="flex cursor-pointer items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-medium">{row.goal}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-[11px] text-muted-foreground">
                          {new Date(row.created_at).toLocaleDateString()}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.preventDefault();
                            deleteMutation.mutate(row.id);
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </span>
                    </summary>
                    <div className="mt-3">
                      <PlanView plan={row.plan} />
                    </div>
                  </details>
                ))}
              </div>
            </Section>
          )}
        </div>

        <div className="grid gap-4">
          <Section
            icon={Users}
            title={t("campaignPlanner.audienceRightNow")}
            description={t("campaignPlanner.computedFromYourRealContacts")}
          >
            {intel.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : segments ? (
              <>
                <StatRow
                  label={t("campaignPlanner.totalContacts")}
                  value={segments.totalContacts.toLocaleString()}
                />
                <StatRow
                  label={t("campaignPlanner.consentRateLeads")}
                  value={`${Math.round(segments.consentedShare * 100)}%`}
                />
                {segments.bySource.length > 0 && (
                  <div>
                    <p className="mb-1 mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("campaignPlanner.bySource")}
                    </p>
                    {segments.bySource.map((s) => (
                      <StatRow key={s.source} label={s.source} value={s.count.toLocaleString()} />
                    ))}
                  </div>
                )}
                {segments.byCountry.length > 0 && (
                  <div>
                    <p className="mb-1 mt-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <Globe2 className="size-3.5" /> {t("campaignPlanner.byCountryFromPhoneCode")}
                    </p>
                    {segments.byCountry.slice(0, 6).map((c) => (
                      <StatRow
                        key={c.country}
                        label={c.countryName}
                        value={c.count.toLocaleString()}
                      />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">{t("campaignPlanner.noDataYet")}</p>
            )}
          </Section>

          <Section
            icon={Radar}
            title={t("campaignPlanner.channelPerformance")}
            description={t("campaignPlanner.rankedByRealAverageEngagement")}
          >
            {intel.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : channels.length > 0 ? (
              channels.map((c) => (
                <div key={c.platform + c.label} className="rounded-lg border p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold capitalize">{c.platform}</span>
                    {c.audience != null && (
                      <Badge variant="outline">
                        {tr("campaignPlanner.audience", {
                          toLocaleString: c.audience.toLocaleString(),
                        })}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {c.postsAnalyzed > 0
                      ? t("campaignPlanner.postsAvgEngagementReach", {
                          postsAnalyzed: c.postsAnalyzed,
                          avgEngagementPerPost: c.avgEngagementPerPost,
                          avgReach: c.avgReach,
                        })
                      : t("campaignPlanner.noPostsSyncedYet")}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">
                {t("campaignPlanner.noConnectedSocialAccountsYet")}
              </p>
            )}
          </Section>
        </div>
      </div>
    </main>
  );
}
