import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, MinusCircle } from "lucide-react";

export type CapabilityState = "available" | "review" | "limited" | "unavailable";

export type CapabilityItem = {
  /** Stable key for React and for tests -- e.g. "publish", "comments", "insights". */
  key: string;
  /** Plain-language name of the thing Flas can (or can't) do, e.g. "Publish posts". */
  label: string;
  state: CapabilityState;
  /** Why it's "review"/"limited" (shown as text) or "unavailable" (shown only with showUnavailable). */
  note?: string | undefined;
};

export type CapabilityListProps = {
  capabilities: CapabilityItem[];
  /** Show "unavailable" entries too. Off by default -- a wall of things Flas cannot do is not the first thing a customer needs to see. */
  showUnavailable?: boolean | undefined;
  className?: string | undefined;
};

const STATE_ICON: Record<CapabilityState, typeof CheckCircle2> = {
  available: CheckCircle2,
  review: AlertTriangle,
  limited: AlertTriangle,
  unavailable: MinusCircle,
};

const STATE_CLASSES: Record<CapabilityState, string> = {
  available:
    "border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-400",
  review:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:border-amber-500/40 dark:text-amber-400",
  limited:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:border-amber-500/40 dark:text-amber-400",
  unavailable: "border-border bg-muted/40 text-muted-foreground",
};

/**
 * A compact, wrapping list of what a connection can actually do. Available
 * capabilities get a quiet checkmark; review/limited capabilities carry their
 * reason as visible text right on the chip (never a tooltip, never hidden);
 * unavailable ones are omitted entirely unless the caller asks to show them
 * -- most screens want to lead with what works, not a wall of what doesn't.
 */
export function CapabilityList({ capabilities, showUnavailable, className }: CapabilityListProps) {
  const visible = capabilities.filter((c) => c.state !== "unavailable" || showUnavailable);
  if (visible.length === 0) return null;

  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)}>
      {visible.map((c) => {
        const Icon = STATE_ICON[c.state];
        return (
          <li
            key={c.key}
            className={cn(
              "flex max-w-full items-start gap-1 rounded-md border px-2 py-1 text-xs leading-tight",
              STATE_CLASSES[c.state],
            )}
          >
            <Icon className="mt-0.5 size-3 shrink-0" />
            <span className="min-w-0 break-words">
              <span className="font-medium">{c.label}</span>
              {c.note ? <span className="block text-[10px] opacity-90">{c.note}</span> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
