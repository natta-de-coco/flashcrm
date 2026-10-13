/*
 * The manager portal's subscription rules, in one browser-safe place.
 *
 * Kept pure so what a manager is told -- whether a company still has access,
 * what a save is about to change -- is asserted directly by tests rather than
 * by clicking through the portal.
 *
 * Access mirrors the company part of public.access_state() (migration
 * 20260907230000): a suspended company is cut off, and once the paid-until
 * moment has passed a company is cut off unless its status is Paid or Trial.
 *
 * A paid-until date is a calendar day. It is stored as the last second of that
 * UTC day and always read back as the UTC day. Reading it in the viewer's zone
 * showed a manager in Dubai (UTC+4) the day after the one they had just set.
 */

export type SubscriptionStatus = "trial" | "active" | "past_due" | "canceled";

export const STATUS_OPTIONS: ReadonlyArray<{
  value: SubscriptionStatus;
  label: string;
  help: string;
}> = [
  {
    value: "trial",
    label: "Free trial",
    help: "Full access. Access does not stop by itself when the date passes.",
  },
  {
    value: "active",
    label: "Paid",
    help: "Full access. Access does not stop by itself when the date passes.",
  },
  {
    value: "past_due",
    label: "Payment issue",
    help: "Access stops once the paid-until date has passed.",
  },
  {
    value: "canceled",
    label: "Canceled",
    help: "Access stops once the paid-until date has passed.",
  },
];

export function statusLabel(status: string | null | undefined): string {
  if (status === "trialing") return "Free trial";
  return STATUS_OPTIONS.find((s) => s.value === status)?.label ?? status ?? "Unknown";
}

export function isSubscriptionStatus(value: string): value is SubscriptionStatus {
  return STATUS_OPTIONS.some((s) => s.value === value);
}

/** Plan ids as checkout and the database use them, with their names. */
export const PLAN_LABELS: Readonly<Record<string, string>> = {
  flash_monthly: "Monthly",
  flash_yearly: "Yearly",
  flash_monthly_20: "Monthly (launch price)",
};

export function planLabel(plan: string | null | undefined): string {
  if (!plan) return "No plan";
  return PLAN_LABELS[plan] ?? plan.replace(/_/g, " ");
}

/** The two plans Flas sells, plus whatever the company is on now. */
export function planOptions(
  current: string | null | undefined,
): { value: string; label: string }[] {
  const values = ["flash_monthly", "flash_yearly"];
  if (current && !values.includes(current)) values.unshift(current);
  return values.map((value) => ({ value, label: planLabel(value) }));
}

export type CompanySubscription = {
  plan: string | null;
  subscription_status: string;
  /** Timestamp, as stored. */
  subscription_renews_at: string | null;
  suspended: boolean;
  paddle_subscription_id?: string | null | undefined;
  stripe_subscription_id?: string | null | undefined;
};

/** Tells card payers (Stripe or Paddle) from manual payers. */
export function billedBy(c: {
  paddle_subscription_id?: string | null | undefined;
  stripe_subscription_id?: string | null | undefined;
}): "stripe" | "paddle" | "manual" {
  if (c.stripe_subscription_id) return "stripe";
  if (c.paddle_subscription_id) return "paddle";
  return "manual";
}

export function isDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** The calendar day a stored paid-until timestamp stands for. */
export function paidUntilDay(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** How a paid-until day is stored: the last second of that UTC day. */
export function paidUntilTimestamp(day: string): string {
  return `${day}T23:59:59.000Z`;
}

export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** "12 Oct 2026" for a YYYY-MM-DD day, the same in every time zone. */
export function formatDay(day: string | null | undefined): string {
  if (!day || !isDay(day)) return "not set";
  const [y, m, d] = day.split("-");
  const month = SHORT_MONTHS[Number(m) - 1];
  return `${d} ${month} ${y}`;
}

/** Whole calendar days from one day to another; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Adds calendar months. The 31st of a shorter month becomes its last day. */
export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  first.setUTCDate(Math.min(d, lastDay));
  return first.toISOString().slice(0, 10);
}

/**
 * Where a recorded payment starts counting from: the current paid-until day
 * while it is still ahead, otherwise today -- so paying early never loses the
 * days already paid for, and paying late does not backdate the new period.
 */
export function extensionBase(paidUntil: string | null, today: string): string {
  return paidUntil && paidUntil > today ? paidUntil : today;
}

export type Access = { allowed: boolean; reason: string };

/** Mirrors the company part of public.access_state(). */
export function companyAccess(c: CompanySubscription, now: Date): Access {
  if (c.suspended) return { allowed: false, reason: "Suspended by a manager." };
  const ends = c.subscription_renews_at ? Date.parse(c.subscription_renews_at) : Number.NaN;
  const lapsed = Number.isFinite(ends) && ends < now.getTime();
  if (lapsed && !["active", "trial", "trialing"].includes(c.subscription_status)) {
    return { allowed: false, reason: "The paid-until date has passed." };
  }
  return {
    allowed: true,
    reason: lapsed
      ? `The date has passed, but the status is ${statusLabel(c.subscription_status)}, which keeps access.`
      : "Full access.",
  };
}

export type Bucket =
  "paid" | "trial" | "expiring" | "expired" | "past_due" | "canceled" | "suspended" | "no_date";

export const BUCKET_LABELS: Readonly<Record<Bucket, string>> = {
  paid: "Paid",
  trial: "Free trial",
  expiring: "Ends within 7 days",
  expired: "Date passed",
  past_due: "Payment issue",
  canceled: "Canceled",
  suspended: "Suspended",
  no_date: "No date set",
};

export function bucketOf(c: CompanySubscription, now: Date): Bucket {
  if (c.suspended) return "suspended";
  if (c.subscription_status === "canceled") return "canceled";
  if (c.subscription_status === "past_due") return "past_due";
  const day = paidUntilDay(c.subscription_renews_at);
  const trial = c.subscription_status === "trial" || c.subscription_status === "trialing";
  if (!day) return trial ? "trial" : "no_date";
  const left = daysBetween(todayUtc(now), day);
  if (left < 0) return "expired";
  if (left <= 7) return "expiring";
  return trial ? "trial" : "paid";
}

/** The companies a manager should look at today. */
export function needsAttention(bucket: Bucket): boolean {
  return (
    bucket === "expired" || bucket === "expiring" || bucket === "past_due" || bucket === "no_date"
  );
}

/** "12 Oct 2026 · 31 days left", "... · last day", "... · ended 3 days ago". */
export function paidUntilText(c: CompanySubscription, now: Date): string {
  const day = paidUntilDay(c.subscription_renews_at);
  if (!day) return "not set";
  const left = daysBetween(todayUtc(now), day);
  if (left > 0) return `${formatDay(day)} · ${left} day${left === 1 ? "" : "s"} left`;
  if (left === 0) return `${formatDay(day)} · last day`;
  return `${formatDay(day)} · ended ${-left} day${left === -1 ? "" : "s"} ago`;
}

export type SubscriptionDraft = {
  plan: string;
  status: SubscriptionStatus;
  /** YYYY-MM-DD, or null when none has ever been set. */
  paidUntil: string | null;
};

export function draftFrom(c: CompanySubscription): SubscriptionDraft {
  return {
    plan: c.plan ?? "",
    status: isSubscriptionStatus(c.subscription_status)
      ? c.subscription_status
      : c.subscription_status === "trialing"
        ? "trial"
        : "active",
    paidUntil: paidUntilDay(c.subscription_renews_at),
  };
}

/** The fields a save sends: only what differs from the company as it is. */
export function changePatch(
  before: CompanySubscription,
  draft: SubscriptionDraft,
): { plan?: string; subscriptionStatus?: SubscriptionStatus; paidUntil?: string } {
  const patch: { plan?: string; subscriptionStatus?: SubscriptionStatus; paidUntil?: string } = {};
  if (draft.plan !== (before.plan ?? "")) patch.plan = draft.plan;
  // Paddle's "trialing" is stored as "trial"; the same status is no change.
  const current = before.subscription_status === "trialing" ? "trial" : before.subscription_status;
  if (draft.status !== current) patch.subscriptionStatus = draft.status;
  if (draft.paidUntil && draft.paidUntil !== paidUntilDay(before.subscription_renews_at)) {
    patch.paidUntil = draft.paidUntil;
  }
  return patch;
}

/** Why a draft cannot be saved, or null when it can. */
export function validateDraft(draft: SubscriptionDraft): string | null {
  if (draft.paidUntil && !isDay(draft.paidUntil)) return "That date does not exist.";
  if (draft.status === "active" && !draft.paidUntil) {
    return "Set the date this company has paid until.";
  }
  return null;
}

/** What saving will change, as sentences a manager can check before confirming. */
export function describeChanges(
  before: CompanySubscription,
  draft: SubscriptionDraft,
  now: Date,
): string[] {
  const out: string[] = [];
  const patch = changePatch(before, draft);
  if (patch.plan !== undefined) {
    out.push(`Plan: ${planLabel(before.plan)} → ${planLabel(patch.plan)}`);
  }
  if (patch.subscriptionStatus !== undefined) {
    out.push(
      `Status: ${statusLabel(before.subscription_status)} → ${statusLabel(patch.subscriptionStatus)}`,
    );
  }
  if (patch.paidUntil !== undefined) {
    out.push(
      `Paid until: ${formatDay(paidUntilDay(before.subscription_renews_at))} → ${formatDay(patch.paidUntil)}`,
    );
  }
  if (out.length === 0) return out;

  const after: CompanySubscription = {
    ...before,
    plan: draft.plan,
    subscription_status: draft.status,
    subscription_renews_at: patch.paidUntil
      ? paidUntilTimestamp(patch.paidUntil)
      : before.subscription_renews_at,
  };
  const was = companyAccess(before, now).allowed;
  const will = companyAccess(after, now).allowed;
  if (was && !will) out.push("Access: everyone at this company loses access now.");
  if (!was && will) out.push("Access: this company gets access back now.");
  return out;
}

export type HistoryDetails = {
  changes?: unknown;
  note?: unknown;
  status?: unknown;
  periodEnd?: unknown;
  subscription_status?: unknown;
  subscription_renews_at?: unknown;
  suspended?: unknown;
};

/** One line for a subscription history entry, old and new record shapes alike. */
export function describeHistory(
  action: string,
  details: HistoryDetails | null | undefined,
): string {
  const d = details ?? {};
  if (action === "billing.subscription_sync") {
    const day = typeof d.periodEnd === "string" ? paidUntilDay(d.periodEnd) : null;
    const status = typeof d.status === "string" ? statusLabel(d.status) : "updated";
    return `Paddle: ${status}${day ? `, paid until ${formatDay(day)}` : ""}`;
  }
  if (Array.isArray(d.changes) && d.changes.length > 0) {
    return d.changes.map(String).join(" · ");
  }
  // Records written before the change list existed hold the raw patch.
  const parts: string[] = [];
  if (typeof d.subscription_status === "string") {
    parts.push(`Status set to ${statusLabel(d.subscription_status)}`);
  }
  if (typeof d.subscription_renews_at === "string") {
    parts.push(`Paid until ${formatDay(paidUntilDay(d.subscription_renews_at))}`);
  }
  if (d.suspended === true) parts.push("Suspended");
  if (d.suspended === false) parts.push("Suspension lifted");
  return parts.length > 0 ? parts.join(" · ") : "Subscription updated";
}
