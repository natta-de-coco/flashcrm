import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  askAdvisor,
  getAdvisorContext,
  getLatestAdvisorAnalysis,
  runAdvisorAnalysis,
  saveAdvisorContext,
} from "@/lib/advisor.functions";
import type { AdvisorAnalysis } from "@/lib/advisor.server";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  Briefcase,
  CalendarClock,
  Globe2,
  Lightbulb,
  MapPin,
  MessageSquare,
  Save,
  Send,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/advisor")({
  head: () => ({
    meta: [
      { title: "Business Advisor — Flash CRM" },
      {
        name: "description",
        content:
          "An expert AI business advisor that reviews your social accounts, chat traffic, products and local market to tell you what to do next.",
      },
      { property: "og:title", content: "Business Advisor — Flash CRM" },
      {
        property: "og:description",
        content:
          "Senior-level business guidance based on your live channel, lead, product and location data.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AdvisorPage,
});

type ChatTurn = { role: "user" | "assistant"; content: string };

const IMPACT_STYLES: Record<string, string> = {
  high: "bg-brand/15 text-brand border-brand/30",
  medium: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  low: "bg-muted text-muted-foreground",
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

function AdvisorPage() {
  const qc = useQueryClient();
  const loadContext = useServerFn(getAdvisorContext);
  const loadLatest = useServerFn(getLatestAdvisorAnalysis);
  const saveContext = useServerFn(saveAdvisorContext);
  const runAnalysis = useServerFn(runAdvisorAnalysis);
  const ask = useServerFn(askAdvisor);

  const [brief, setBrief] = useState({
    business_name: "",
    industry: "",
    niche: "",
    city: "",
    country: "",
    currency: "",
    business_stage: "",
    monthly_revenue_target: "",
    main_goal: "",
    competitors: "",
    description: "",
    website_url: "",
  });

  const context = useQuery({ queryKey: ["advisor_context"], queryFn: () => loadContext({}) });
  const latest = useQuery({ queryKey: ["advisor_latest"], queryFn: () => loadLatest({}) });

  useEffect(() => {
    const p = context.data?.profile;
    if (!p) return;
    setBrief({
      business_name: p.business_name ?? "",
      industry: p.industry ?? "",
      niche: p.niche ?? "",
      city: p.city ?? "",
      country: p.country ?? "",
      currency: p.currency ?? "",
      business_stage: p.business_stage ?? "",
      monthly_revenue_target: p.monthly_revenue_target != null ? String(p.monthly_revenue_target) : "",
      main_goal: p.main_goal ?? "",
      competitors: p.competitors ?? "",
      description: p.description ?? "",
      website_url: p.website_url ?? "",
    });
  }, [context.data]);

  const [analysis, setAnalysis] = useState<AdvisorAnalysis | null>(null);
  useEffect(() => {
    if (latest.data?.analysis) setAnalysis(latest.data.analysis as AdvisorAnalysis);
  }, [latest.data]);

  const save = useMutation({
    mutationFn: () =>
      saveContext({
        data: {
          ...brief,
          business_name: brief.business_name || null,
          industry: brief.industry || null,
          niche: brief.niche || null,
          city: brief.city || null,
          country: brief.country || null,
          currency: brief.currency || null,
          business_stage: brief.business_stage || null,
          main_goal: brief.main_goal || null,
          competitors: brief.competitors || null,
          description: brief.description || null,
          website_url: brief.website_url || null,
          monthly_revenue_target: brief.monthly_revenue_target
            ? Number(brief.monthly_revenue_target)
            : null,
        },
      }),
    onSuccess: () => {
      toast.success("Business brief saved — the advisor will use it from now on");
      void qc.invalidateQueries({ queryKey: ["advisor_context"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const review = useMutation({
    mutationFn: () => runAnalysis({}),
    onSuccess: (data) => {
      setAnalysis(data as AdvisorAnalysis);
      toast.success("Advisor review ready");
      void qc.invalidateQueries({ queryKey: ["advisor_latest"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [question, setQuestion] = useState("");
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const sendQuestion = useMutation({
    mutationFn: async (q: string) => {
      const res = await ask({ data: { question: q, history: chat } });
      return res.answer;
    },
    onSuccess: (answer, q) => setChat((c) => [...c, { role: "user", content: q }, { role: "assistant", content: answer }]),
    onError: (e: Error) => toast.error(e.message),
  });

  function submitQuestion() {
    const q = question.trim();
    if (q.length < 3) {
      toast.error("Ask a slightly longer question");
      return;
    }
    setQuestion("");
    sendQuestion.mutate(q);
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Briefcase className="size-6 text-brand" /> Business advisor
        </h1>
        <p className="text-sm text-muted-foreground">
          A senior operator for your niche. It reads your chat traffic, social accounts, leads,
          products and your city/country market, then tells you exactly what to do next.
        </p>
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid gap-4">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="size-4 text-brand" /> Strategic review
                </CardTitle>
                <CardDescription>
                  {analysis
                    ? `Last review ${new Date(analysis.generatedAt).toLocaleString()}`
                    : "Run a review to get scores, opportunities, risks and a 7-day plan."}
                </CardDescription>
              </div>
              <Button onClick={() => review.mutate()} disabled={review.isPending}>
                <TrendingUp className="size-4" />
                {review.isPending ? "Analyzing…" : analysis ? "Re-analyze" : "Analyze my business"}
              </Button>
            </CardHeader>
            {review.isPending && !analysis ? (
              <CardContent className="grid gap-2">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </CardContent>
            ) : analysis ? (
              <CardContent className="grid gap-4 text-sm">
                <p className="rounded-lg border bg-muted/40 p-3 font-medium">{analysis.verdict}</p>
                {analysis.positioning ? (
                  <p className="text-muted-foreground">{analysis.positioning}</p>
                ) : null}
                {analysis.scores.length > 0 ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {analysis.scores.map((s) => (
                      <div key={s.label} className="rounded-lg border p-3">
                        <div className="mb-1 flex items-center justify-between text-xs font-medium">
                          <span>{s.label}</span>
                          <span className="text-muted-foreground">{s.score}/100</span>
                        </div>
                        <Progress value={Math.max(0, Math.min(100, s.score))} className="h-1.5" />
                        <p className="mt-2 text-xs text-muted-foreground">{s.note}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            ) : (
              <CardContent className="text-sm text-muted-foreground">
                No review yet. Fill in the business brief on the right for sharper, location-aware
                advice, then run the analysis.
              </CardContent>
            )}
          </Card>

          {analysis && analysis.opportunities.length > 0 ? (
            <Section
              icon={Lightbulb}
              title="Growth opportunities"
              description="Ranked by expected impact on revenue."
            >
              {analysis.opportunities.map((o) => (
                <div key={o.title} className="rounded-lg border p-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="font-medium">{o.title}</span>
                    <Badge variant="outline" className={IMPACT_STYLES[o.impact] ?? IMPACT_STYLES.low}>
                      {o.impact} impact
                    </Badge>
                  </div>
                  <p className="text-muted-foreground">{o.why}</p>
                  <p className="mt-1">
                    <span className="font-medium">Do: </span>
                    {o.action}
                  </p>
                </div>
              ))}
            </Section>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            {analysis && analysis.local.length > 0 ? (
              <Section
                icon={MapPin}
                title="Local market"
                description={[brief.city, brief.country].filter(Boolean).join(", ") || undefined}
              >
                <ul className="list-disc space-y-1.5 pl-4">
                  {analysis.local.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </Section>
            ) : null}

            {analysis && analysis.socialPlan.length > 0 ? (
              <Section icon={Globe2} title="Social & traffic plan">
                {analysis.socialPlan.map((s) => (
                  <div key={s.platform}>
                    <span className="font-medium capitalize">{s.platform}: </span>
                    <span className="text-muted-foreground">{s.recommendation}</span>
                  </div>
                ))}
              </Section>
            ) : null}

            {analysis && analysis.pricing.length > 0 ? (
              <Section icon={Target} title="Products & pricing">
                <ul className="list-disc space-y-1.5 pl-4">
                  {analysis.pricing.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </Section>
            ) : null}

            {analysis && analysis.risks.length > 0 ? (
              <Section icon={AlertTriangle} title="Risks to fix">
                <ul className="list-disc space-y-1.5 pl-4">
                  {analysis.risks.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </Section>
            ) : null}

            {analysis && (analysis.next7Days.length > 0 || analysis.next90Days.length > 0) ? (
              <Section icon={CalendarClock} title="Action plan">
                {analysis.next7Days.length > 0 ? (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                      Next 7 days
                    </p>
                    <ol className="list-decimal space-y-1 pl-4">
                      {analysis.next7Days.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ol>
                  </div>
                ) : null}
                {analysis.next90Days.length > 0 ? (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                      Next 90 days
                    </p>
                    <ol className="list-decimal space-y-1 pl-4">
                      {analysis.next90Days.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ol>
                  </div>
                ) : null}
              </Section>
            ) : null}

            {analysis && analysis.kpis.length > 0 ? (
              <Section icon={TrendingUp} title="KPIs to track">
                {analysis.kpis.map((k) => (
                  <div key={k.name} className="flex items-center justify-between gap-3 border-b pb-1.5 last:border-0">
                    <span>{k.name}</span>
                    <span className="font-medium">{k.target}</span>
                  </div>
                ))}
              </Section>
            ) : null}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageSquare className="size-4 text-brand" /> Ask the advisor
              </CardTitle>
              <CardDescription>
                Anything about pricing, hiring, offers, ads, competitors or your city's market.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {chat.length === 0 ? (
                <div className="flex flex-wrap gap-2">
                  {[
                    "Which channel should I double down on this month?",
                    "How do I price my top product for my city?",
                    "What offer will win back cold leads?",
                  ].map((s) => (
                    <Button
                      key={s}
                      variant="outline"
                      size="sm"
                      onClick={() => sendQuestion.mutate(s)}
                      disabled={sendQuestion.isPending}
                    >
                      {s}
                    </Button>
                  ))}
                </div>
              ) : (
                <div className="grid gap-3">
                  {chat.map((t, i) => (
                    <div
                      key={`${t.role}-${i}`}
                      className={
                        t.role === "user"
                          ? "ml-auto max-w-[85%] rounded-lg bg-brand/10 px-3 py-2 text-sm"
                          : "max-w-full rounded-lg border p-3 text-sm"
                      }
                    >
                      {t.role === "assistant" ? (
                        <div className="prose prose-sm max-w-none dark:prose-invert">
                          <ReactMarkdown>{t.content}</ReactMarkdown>
                        </div>
                      ) : (
                        t.content
                      )}
                    </div>
                  ))}
                </div>
              )}
              {sendQuestion.isPending ? <Skeleton className="h-16 w-full" /> : null}
              <div className="flex flex-col gap-2 sm:flex-row">
                <Textarea
                  rows={2}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="e.g. My inbound dropped 20% — what should I change first?"
                />
                <Button onClick={submitQuestion} disabled={sendQuestion.isPending} className="sm:self-end">
                  <Send className="size-4" /> Ask
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Business brief</CardTitle>
            <CardDescription>
              The more the advisor knows, the sharper the advice. Location drives local demand,
              pricing power and seasonality.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {context.isLoading ? (
              <>
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-24 w-full" />
              </>
            ) : (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="business_name">Business name</Label>
                  <Input
                    id="business_name"
                    value={brief.business_name}
                    onChange={(e) => setBrief({ ...brief, business_name: e.target.value })}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="industry">Industry</Label>
                    <Input
                      id="industry"
                      placeholder="Retail, clinic, real estate…"
                      value={brief.industry}
                      onChange={(e) => setBrief({ ...brief, industry: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="niche">Niche</Label>
                    <Input
                      id="niche"
                      placeholder="Bridal wear, dental implants…"
                      value={brief.niche}
                      onChange={(e) => setBrief({ ...brief, niche: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="city">City</Label>
                    <Input
                      id="city"
                      value={brief.city}
                      onChange={(e) => setBrief({ ...brief, city: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="country">Country</Label>
                    <Input
                      id="country"
                      value={brief.country}
                      onChange={(e) => setBrief({ ...brief, country: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="stage">Stage</Label>
                    <Input
                      id="stage"
                      placeholder="New, growing, established"
                      value={brief.business_stage}
                      onChange={(e) => setBrief({ ...brief, business_stage: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="currency">Currency</Label>
                    <Input
                      id="currency"
                      placeholder="AED, USD…"
                      value={brief.currency}
                      onChange={(e) => setBrief({ ...brief, currency: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="target">Monthly revenue target</Label>
                  <Input
                    id="target"
                    type="number"
                    min={0}
                    value={brief.monthly_revenue_target}
                    onChange={(e) => setBrief({ ...brief, monthly_revenue_target: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="website">Website</Label>
                  <Input
                    id="website"
                    placeholder="https://…"
                    value={brief.website_url}
                    onChange={(e) => setBrief({ ...brief, website_url: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="goal">Main goal right now</Label>
                  <Textarea
                    id="goal"
                    rows={2}
                    value={brief.main_goal}
                    onChange={(e) => setBrief({ ...brief, main_goal: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="competitors">Main competitors</Label>
                  <Textarea
                    id="competitors"
                    rows={2}
                    value={brief.competitors}
                    onChange={(e) => setBrief({ ...brief, competitors: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="about">About the business</Label>
                  <Textarea
                    id="about"
                    rows={4}
                    value={brief.description}
                    onChange={(e) => setBrief({ ...brief, description: e.target.value })}
                  />
                </div>
                <Button onClick={() => save.mutate()} disabled={save.isPending} variant="secondary">
                  <Save className="size-4" /> Save brief
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
