import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getSubscriptionHistory, updateCompanyStatus } from "@/lib/companies.functions";
import { formatMomentUnambiguous } from "@/lib/locale";
import {
  STATUS_OPTIONS,
  addMonths,
  billedBy,
  changePatch,
  companyAccess,
  describeChanges,
  draftFrom,
  extensionBase,
  formatDay,
  paidUntilDay,
  paidUntilText,
  planOptions,
  statusLabel,
  todayUtc,
  validateDraft,
  type CompanySubscription,
  type SubscriptionDraft,
  type SubscriptionStatus,
} from "@/lib/subscription-admin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarPlus, CreditCard, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

export type ManagedCompany = CompanySubscription & { id: string; name: string };

type SaveInput = {
  organizationId: string;
  plan?: string;
  subscriptionStatus?: SubscriptionStatus;
  paidUntil?: string;
  suspended?: boolean;
  note?: string;
};

const PAYMENT_PERIODS = [
  { months: 1, label: "1 month" },
  { months: 3, label: "3 months" },
  { months: 12, label: "1 year" },
] as const;

/**
 * Everything about one company's subscription in one place: record a payment,
 * change the plan or status, suspend, and see who changed what.
 *
 * Nothing is saved until "Save changes", and the dialog lists what a save will
 * do -- including whether the company gains or loses access -- before it is
 * sent. The old page saved a date the moment the field lost focus, and one
 * click on Suspend cut a whole company off with no confirmation.
 */
export function ManageSubscriptionDialog({
  company,
  trigger,
}: {
  company: ManagedCompany;
  trigger?: ReactNode;
}) {
  const qc = useQueryClient();
  const save = useServerFn(updateCompanyStatus);
  const loadHistory = useServerFn(getSubscriptionHistory);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SubscriptionDraft>(() => draftFrom(company));
  const [note, setNote] = useState("");

  const now = new Date();
  const today = todayUtc(now);
  const access = companyAccess(company, now);
  const paddle = billedBy(company) === "paddle";
  const changes = describeChanges(company, draft, now);
  const problem = validateDraft(draft);
  const base = extensionBase(paidUntilDay(company.subscription_renews_at), today);
  const statusHelp = STATUS_OPTIONS.find((s) => s.value === draft.status)?.help;
  const noteField = note.trim() ? { note: note.trim() } : {};

  const history = useQuery({
    queryKey: ["subscription-history", company.id],
    queryFn: () => loadHistory({ data: { organizationId: company.id } }),
    enabled: open,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["manager-subscriptions"] });
    void qc.invalidateQueries({ queryKey: ["company-workspace", company.id] });
    void qc.invalidateQueries({ queryKey: ["subscription-history", company.id] });
  };

  const saveMutation = useMutation({
    mutationFn: (input: SaveInput) => save({ data: input }),
    onSuccess: (res) => {
      toast.success(`${company.name}: ${res.changes[0] ?? "saved"}`);
      refresh();
      setNote("");
      setOpen(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });

  const suspendMutation = useMutation({
    mutationFn: (suspended: boolean) =>
      save({ data: { organizationId: company.id, suspended, ...noteField } }),
    onSuccess: (_res, suspended) => {
      toast.success(
        suspended ? `${company.name} is suspended` : `${company.name} can use Flas again`,
      );
      refresh();
      setNote("");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update access"),
  });

  const onOpenChange = (next: boolean) => {
    if (next) {
      setDraft(draftFrom(company));
      setNote("");
    }
    setOpen(next);
  };

  const recordPayment = (months: number) =>
    setDraft((d) => ({ ...d, status: "active", paidUntil: addMonths(base, months) }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="outline" className="gap-1">
            <CreditCard className="size-3.5" /> Manage
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Subscription — {company.name}</DialogTitle>
          <DialogDescription>
            {statusLabel(company.subscription_status)} · paid until {paidUntilText(company, now)}
          </DialogDescription>
        </DialogHeader>

        <div
          className={`rounded-lg border p-3 text-xs ${
            access.allowed ? "" : "border-destructive/40 bg-destructive/5"
          }`}
        >
          <p className="font-medium">
            {access.allowed ? "They can use Flas." : "They cannot use Flas right now."}
          </p>
          <p className="text-muted-foreground">{access.reason}</p>
          <p className="mt-1 text-muted-foreground">
            {paddle ? "Pays by card through Paddle." : "Pays manually (cash or bank transfer)."}
          </p>
        </div>

        {paddle && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            Paddle sets this company&apos;s status and paid-until date after each payment or
            cancellation, replacing changes made here. Use this form for corrections.
          </p>
        )}

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Record a payment</h3>
          <p className="text-xs text-muted-foreground">
            Sets the status to Paid and counts from {formatDay(base)}
            {base === today ? " (today)" : " (their current paid-until date)"}.
          </p>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_PERIODS.map((p) => (
              <Button
                key={p.months}
                type="button"
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => recordPayment(p.months)}
              >
                <CalendarPlus className="size-3.5" />
                {p.label} → {formatDay(addMonths(base, p.months))}
              </Button>
            ))}
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor={`plan-${company.id}`}>Plan</Label>
            <Select value={draft.plan} onValueChange={(plan) => setDraft((d) => ({ ...d, plan }))}>
              <SelectTrigger id={`plan-${company.id}`}>
                <SelectValue placeholder="Choose a plan" />
              </SelectTrigger>
              <SelectContent>
                {planOptions(company.plan).map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`status-${company.id}`}>Status</Label>
            <Select
              value={draft.status}
              onValueChange={(v) => setDraft((d) => ({ ...d, status: v as SubscriptionStatus }))}
            >
              <SelectTrigger id={`status-${company.id}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`paid-${company.id}`}>Paid until</Label>
            <Input
              id={`paid-${company.id}`}
              type="date"
              value={draft.paidUntil ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, paidUntil: e.target.value || null }))}
            />
          </div>
        </section>
        {statusHelp && (
          <p className="text-xs text-muted-foreground">
            {statusLabel(draft.status)}: {statusHelp}
          </p>
        )}

        <div className="space-y-1">
          <Label htmlFor={`note-${company.id}`}>Note for the history (optional)</Label>
          <Input
            id={`note-${company.id}`}
            value={note}
            maxLength={280}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Cash AED 240 received for one year"
          />
        </div>

        <div className="rounded-lg border bg-muted/40 p-3 text-xs">
          {changes.length === 0 ? (
            <p className="text-muted-foreground">No changes yet.</p>
          ) : (
            <>
              <p className="mb-1 font-medium">Saving will change:</p>
              <ul className="list-disc space-y-0.5 pl-4">
                {changes.map((c) => (
                  <li
                    key={c}
                    className={
                      c.startsWith("Access: everyone") ? "font-medium text-destructive" : ""
                    }
                  >
                    {c}
                  </li>
                ))}
              </ul>
            </>
          )}
          {problem && <p className="mt-1 font-medium text-destructive">{problem}</p>}
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
          <Button
            type="button"
            disabled={changes.length === 0 || Boolean(problem) || saveMutation.isPending}
            onClick={() =>
              saveMutation.mutate({
                organizationId: company.id,
                ...changePatch(company, draft),
                ...noteField,
              })
            }
          >
            {saveMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Save changes
          </Button>
        </div>

        <section className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-semibold">Suspend</h3>
          <p className="text-xs text-muted-foreground">
            {company.suspended
              ? "This company is suspended: nobody at it can use Flas."
              : "Suspending cuts off everyone at this company at once, whatever they have paid. Their data is kept."}
          </p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant={company.suspended ? "outline" : "destructive"}
                className="gap-1"
                disabled={suspendMutation.isPending}
              >
                {company.suspended ? (
                  <>
                    <ShieldCheck className="size-3.5" /> Lift suspension
                  </>
                ) : (
                  <>
                    <ShieldOff className="size-3.5" /> Suspend company
                  </>
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {company.suspended
                    ? `Give ${company.name} access again?`
                    : `Suspend ${company.name}?`}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {company.suspended
                    ? "Everyone at this company can use Flas again, unless their paid-until date has passed and their status is Payment issue or Canceled."
                    : "Everyone at this company loses access immediately. Nothing is deleted, and you can lift the suspension at any time."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => suspendMutation.mutate(!company.suspended)}>
                  {company.suspended ? "Lift suspension" : "Suspend"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </section>

        <section className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-semibold">History</h3>
          {history.isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
          {history.error && (
            <p className="text-xs text-destructive">
              {history.error instanceof Error ? history.error.message : "Could not load history"}
            </p>
          )}
          {history.data?.length === 0 && (
            <p className="text-xs text-muted-foreground">No subscription changes recorded yet.</p>
          )}
          <ul className="space-y-2">
            {history.data?.map((h) => (
              <li key={h.id} className="text-xs">
                <p>{h.text}</p>
                <p className="text-muted-foreground">
                  {formatMomentUnambiguous(h.at)} · {h.who}
                  {h.note ? ` · “${h.note}”` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </DialogContent>
    </Dialog>
  );
}
