import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { completeAdvisorFollowUp, startAdvisorFollowUp } from "@/lib/advisor.functions";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ListChecks, MessageCircleQuestion, RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/hooks/useI18n";
import { hasMessage, type MessageKey } from "@/lib/i18n";

type Question = { id: string; question: string; why: string };
type Plan = {
  summary: string;
  actions: { action: string; why: string; owner: string; when: string; impact: string }[];
  watchouts: string[];
};

/**
 * Structured follow-up mode: the advisor asks 3-5 clarifying questions grounded
 * in live traffic and product data before handing back next actions.
 */
export function FollowUpCard() {
  const { t, tr } = useI18n();
  const start = useServerFn(startAdvisorFollowUp);
  const complete = useServerFn(completeAdvisorFollowUp);

  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<Plan | null>(null);

  const begin = useMutation({
    mutationFn: () => start({}),
    onSuccess: (res) => {
      setPlan(null);
      setAnswers({});
      setQuestions(res.questions);
      if (res.questions.length === 0) {
        toast.error(t("followUpCard.theAdvisorNeedsABit"));
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const finish = useMutation({
    mutationFn: () => {
      const payload = questions
        .map((q) => ({ question: q.question, answer: (answers[q.id] ?? "").trim() }))
        .filter((a) => a.answer.length > 0);
      if (payload.length === 0) throw new Error("Answer at least one question first");
      return complete({ data: { answers: payload } });
    },
    onSuccess: (res) => setPlan(res),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageCircleQuestion className="size-4 text-brand" /> {t("followUpCard.followUpMode")}
          </CardTitle>
          <CardDescription>{t("followUpCard.yourAdvisorInterviewsYouFirst")}</CardDescription>
        </div>
        <Button
          size="sm"
          variant={questions.length > 0 ? "outline" : "secondary"}
          onClick={() => begin.mutate()}
          disabled={begin.isPending}
        >
          {questions.length > 0 ? <RotateCcw className="size-4" /> : null}
          {begin.isPending
            ? t("followUpCard.preparingQuestions")
            : questions.length > 0
              ? t("followUpCard.newInterview")
              : t("followUpCard.startFollowUp")}
        </Button>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        {begin.isPending ? (
          <>
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </>
        ) : null}

        {questions.length === 0 && !begin.isPending ? (
          <p className="text-muted-foreground">{t("followUpCard.startTheFollowUpWhen")}</p>
        ) : null}

        {questions.map((q, i) => (
          <div key={q.id} className="grid gap-1.5">
            <Label htmlFor={q.id} className="leading-snug">
              {i + 1}. {q.question}
            </Label>
            {q.why ? (
              <p className="text-xs text-muted-foreground">
                {tr("followUpCard.whyItMatters", { why: q.why })}
              </p>
            ) : null}
            <Textarea
              id={q.id}
              rows={2}
              placeholder={t("followUpCard.yourAnswer")}
              value={answers[q.id] ?? ""}
              onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
            />
          </div>
        ))}

        {questions.length > 0 ? (
          <Button
            className="justify-self-start"
            onClick={() => finish.mutate()}
            disabled={finish.isPending}
          >
            <ListChecks className="size-4" />
            {finish.isPending
              ? t("followUpCard.buildingYourPlan")
              : t("followUpCard.getMyNextActions")}
          </Button>
        ) : null}

        {plan ? (
          <div className="grid gap-3 rounded-lg border bg-muted/40 p-4">
            <p className="font-medium">{plan.summary}</p>
            <div className="grid gap-2">
              {plan.actions.map((a, i) => (
                <div key={i} className="rounded-md border bg-background p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{a.action}</span>
                    <Badge
                      variant={a.impact === "high" ? "default" : "outline"}
                      className="text-[10px]"
                    >
                      {hasMessage(`advisor.impactLevel.${a.impact}`)
                        ? t(`advisor.impactLevel.${a.impact}` as MessageKey)
                        : tr("followUpCard.impact", { impact: a.impact })}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      {a.when}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{a.why}</p>
                  {a.owner ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {tr("followUpCard.owner", { owner: a.owner })}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
            {plan.watchouts.length > 0 ? (
              <div className="grid gap-1">
                <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <AlertTriangle className="size-3.5" /> {t("followUpCard.watchOutFor")}
                </p>
                <ul className="list-disc ps-5 text-xs text-muted-foreground">
                  {plan.watchouts.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
