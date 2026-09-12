import { Badge } from "@/components/ui/badge";
import { READINESS_LABELS, type ReadinessState } from "@/lib/connection-problem";
import { cn } from "@/lib/utils";

export type ReadinessBadgeProps = {
  state: ReadinessState;
  className?: string | undefined;
};

type Tone = "good" | "warn" | "bad" | "neutral";

const READINESS_TONE: Record<ReadinessState, Tone> = {
  READY: "good",
  NEEDS_CONFIGURATION: "warn",
  NEEDS_PROVIDER_CONFIGURATION: "warn",
  NEEDS_PROVIDER_REVIEW: "warn",
  NEEDS_RECONNECT: "warn",
  PARTIAL_PERMISSION: "neutral",
  PROVIDER_ERROR: "bad",
  FLAS_CONFIGURATION_ERROR: "bad",
};

const TONE_CLASSES: Record<Tone, string> = {
  good: "border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-400",
  warn: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:border-amber-500/40 dark:text-amber-400",
  bad: "border-destructive/40 bg-destructive/10 text-destructive",
  neutral: "border-border bg-muted text-muted-foreground",
};

/** A ReadinessState rendered as a badge, using the shared READINESS_LABELS copy and one tone per state. */
export function ReadinessBadge({ state, className }: ReadinessBadgeProps) {
  return (
    <Badge variant="outline" className={cn(TONE_CLASSES[READINESS_TONE[state]], className)}>
      {READINESS_LABELS[state]}
    </Badge>
  );
}
