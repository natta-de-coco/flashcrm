/**
 * src/components/marketing/DripSequenceBuilder.tsx
 *
 * Visual Multi-Step Email Marketing Drip Funnel Timeline.
 * Shows the automated 3-step lead nurture journey with delay intervals,
 * template previews, discount tags, and enrollment analytics.
 */

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  getDripSequenceOverview,
  toggleDripSequence,
  type DripOverviewData,
} from "@/lib/drip.functions";
import { friendlyError } from "@/lib/friendly-error";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowDown,
  CheckCircle2,
  Clock,
  Gift,
  Mail,
  Send,
  Sparkles,
  Tag,
  TrendingUp,
  UserCheck,
  UserMinus,
  Users,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

export function DripSequenceBuilder() {
  const qc = useQueryClient();
  const getOverviewFn = useServerFn(getDripSequenceOverview);
  const toggleFn = useServerFn(toggleDripSequence);

  const { data, isLoading } = useQuery<DripOverviewData>({
    queryKey: ["drip_sequence_overview"],
    queryFn: async () => {
      return await getOverviewFn();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ sequenceId, active }: { sequenceId: string; active: boolean }) => {
      return await toggleFn({ data: { sequenceId, active } });
    },
    onSuccess: (res) => {
      toast.success(res.active ? "Drip automation activated!" : "Drip automation paused.");
      void qc.invalidateQueries({ queryKey: ["drip_sequence_overview"] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-20 bg-muted/40 rounded-xl" />
        <div className="h-64 bg-muted/30 rounded-xl" />
      </div>
    );
  }

  const { stats, steps } = data;

  return (
    <div className="space-y-6">
      {/* Sequence Header & Controls */}
      <Card className="shadow-sm border-emerald-500/20 bg-gradient-to-r from-emerald-50/30 via-background to-background dark:from-emerald-950/10">
        <CardHeader className="p-4 sm:p-6 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Zap className="h-4 w-4" />
                </span>
                <CardTitle className="text-base sm:text-lg font-bold">{data.name}</CardTitle>
                <Badge
                  variant={data.active ? "default" : "secondary"}
                  className={data.active ? "bg-emerald-600 text-white text-xs" : "text-xs"}
                >
                  {data.active ? "Active & Running" : "Paused"}
                </Badge>
              </div>
              <CardDescription className="text-xs">
                {data.description}
              </CardDescription>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-muted-foreground">
                {data.active ? "Automation Active" : "Automation Paused"}
              </span>
              <Switch
                checked={data.active}
                onCheckedChange={(checked) =>
                  toggleMutation.mutate({ sequenceId: data.sequenceId, active: checked })
                }
                disabled={toggleMutation.isPending}
              />
            </div>
          </div>
        </CardHeader>

        {/* Live Enrollment Funnel Counters */}
        <CardContent className="p-4 sm:p-6 pt-0 border-t mt-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4">
            <div className="p-3 rounded-lg bg-muted/40 border">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Users className="h-3 w-3" /> Total Enrolled
              </p>
              <p className="text-xl font-bold mt-1">{stats.totalEnrolled.toLocaleString()}</p>
            </div>

            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <p className="text-[11px] text-amber-700 dark:text-amber-300 flex items-center gap-1">
                <Clock className="h-3 w-3" /> In Progress (Nurturing)
              </p>
              <p className="text-xl font-bold text-amber-700 dark:text-amber-300 mt-1">
                {stats.inProgress.toLocaleString()}
              </p>
            </div>

            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <p className="text-[11px] text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Completed Funnel
              </p>
              <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300 mt-1">
                {stats.completed.toLocaleString()}
              </p>
            </div>

            <div className="p-3 rounded-lg bg-muted/40 border">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <UserMinus className="h-3 w-3" /> Unsubscribed
              </p>
              <p className="text-xl font-bold mt-1">{stats.unsubscribed.toLocaleString()}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Visual Step-by-Step Funnel Timeline */}
      <div className="relative pl-6 sm:pl-8 space-y-6 before:absolute before:left-3 sm:before:left-4 before:top-4 before:bottom-4 before:w-0.5 before:bg-border">
        {steps.map((step, idx) => {
          const isFirst = idx === 0;
          const isLast = idx === steps.length - 1;

          return (
            <div key={step.id} className="relative">
              {/* Timeline Step Node Circle */}
              <div className="absolute -left-6 sm:-left-8 top-3 flex items-center justify-center w-6 h-6 rounded-full bg-background border-2 border-emerald-600 text-emerald-600 text-xs font-bold shadow-sm">
                {step.stepNumber}
              </div>

              {/* Step Card Content */}
              <Card className="shadow-sm hover:shadow transition-shadow">
                <CardHeader className="p-4 pb-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[11px] font-semibold">
                        {isFirst ? "Instant Trigger" : `Wait ${step.delayDays} Days`}
                      </Badge>
                      <Badge className="bg-primary/10 text-primary hover:bg-primary/20 text-[10px]">
                        Template: {step.templateId.replace(/_/g, " ")}
                      </Badge>
                    </div>

                    {step.discountCode && (
                      <Badge className="bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border-amber-300 text-[10px] gap-1">
                        <Tag className="h-2.5 w-2.5" />
                        Code: {step.discountCode}
                      </Badge>
                    )}
                  </div>

                  <CardTitle className="text-sm font-bold mt-2 flex items-center gap-2">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                    {step.subject}
                  </CardTitle>
                </CardHeader>

                <CardContent className="p-4 pt-1 text-xs text-muted-foreground">
                  {isFirst && (
                    <p>
                      Dispatched immediately when a visitor subscribes via the website chat widget or
                      lead form with marketing consent. Delivers their initial discount promo code.
                    </p>
                  )}
                  {step.stepNumber === 2 && (
                    <p>
                      Follows up 3 days later with an educational showcase highlighting how your core
                      product or service solves their key pain points. Encourages booking a demo or quotation.
                    </p>
                  )}
                  {isLast && (
                    <p>
                      Dispatched 7 days after signup to create urgency. Notifies the lead that their
                      welcome promotion is expiring in 48 hours to drive immediate conversion.
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );
}
