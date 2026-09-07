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
  function copyMessage() {
    void navigator.clipboard.writeText(plan.draftOpeningMessage);
    toast.success("Draft message copied");
  }

  return (
    <div className="grid gap-4">
      {plan.summary && <p className="text-sm leading-relaxed">{plan.summary}</p>}

      {plan.targetSegments.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Users className="size-3.5" /> Target segments
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
            <Radar className="size-3.5" /> Recommended channels
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
            <MapPin className="size-3.5" /> Geographic focus
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
          No usable geographic signal yet — connect more contacts with phone numbers, or add real
          location tracking, to unlock area-level targeting.
        </p>
      )}

      {plan.timing && (
        <div className="rounded-lg border p-2.5">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Timing
          </p>
          <p className="text-sm">{plan.timing}</p>
        </div>
      )}

      {plan.messagingAngle && (
        <div className="rounded-lg border p-2.5">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Messaging angle
          </p>
          <p className="text-sm">{plan.messagingAngle}</p>
        </div>
      )}

      {plan.draftOpeningMessage && (
        <div className="rounded-lg border bg-muted/40 p-2.5">
          <div className="mb-1 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <MessageSquareText className="size-3.5" /> Draft opening message
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
            Risks &amp; data gaps
          </p>
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
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
      toast.success("Campaign plan ready");
      void qc.invalidateQueries({ queryKey: ["campaign-plans"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => removePlan({ data: { id } }),
    onSuccess: () => {
      toast.success("Plan removed");
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
          <Target className="size-6 text-brand" /> Campaign Planner
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Describe what you're promoting. The plan below is grounded in your actual contacts, leads,
          and connected social channels — never invented numbers.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid gap-4">
          <Section
            icon={Sparkles}
            title="New campaign"
            description="One or two sentences is enough — the more specific, the sharper the plan."
          >
            <div className="grid gap-1.5">
              <Label htmlFor="goal">Campaign goal</Label>
              <Textarea
                id="goal"
                rows={3}
                placeholder="e.g. Get 50 more bookings for our weekend detailing package this month"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="product">Product / service (optional)</Label>
                <Input
                  id="product"
                  placeholder="e.g. Weekend detailing package"
                  value={product}
                  onChange={(e) => setProduct(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="budget">Budget / constraints (optional)</Label>
                <Input
                  id="budget"
                  placeholder="e.g. AED 2,000, organic + one boosted post"
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
              Generate plan
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
            <Section icon={TrendingUp} title="Latest plan">
              <PlanView plan={latestPlan} />
            </Section>
          )}

          {(plans.data ?? []).length > 0 && (
            <Section icon={History} title="Past plans">
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
            title="Audience, right now"
            description="Computed from your real contacts and leads."
          >
            {intel.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : segments ? (
              <>
                <StatRow label="Total contacts" value={segments.totalContacts.toLocaleString()} />
                <StatRow
                  label="Consent rate (leads)"
                  value={`${Math.round(segments.consentedShare * 100)}%`}
                />
                {segments.bySource.length > 0 && (
                  <div>
                    <p className="mb-1 mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      By source
                    </p>
                    {segments.bySource.map((s) => (
                      <StatRow key={s.source} label={s.source} value={s.count.toLocaleString()} />
                    ))}
                  </div>
                )}
                {segments.byCountry.length > 0 && (
                  <div>
                    <p className="mb-1 mt-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <Globe2 className="size-3.5" /> By country (from phone code, approximate)
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
              <p className="text-xs text-muted-foreground">No data yet.</p>
            )}
          </Section>

          <Section
            icon={Radar}
            title="Channel performance"
            description="Ranked by real average engagement per post, not follower count alone."
          >
            {intel.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : channels.length > 0 ? (
              channels.map((c) => (
                <div key={c.platform + c.label} className="rounded-lg border p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold capitalize">{c.platform}</span>
                    {c.audience != null && (
                      <Badge variant="outline">{c.audience.toLocaleString()} audience</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {c.postsAnalyzed > 0
                      ? `${c.postsAnalyzed} posts · avg ${c.avgEngagementPerPost} engagement, ${c.avgReach} reach`
                      : "No posts synced yet"}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">
                No connected social accounts yet — connect one from the Social Hub to unlock
                channel-ranked recommendations.
              </p>
            )}
          </Section>
        </div>
      </div>
    </main>
  );
}
