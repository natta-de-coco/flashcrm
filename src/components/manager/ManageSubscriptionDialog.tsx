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
import { useI18n } from "@/hooks/useI18n";

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
  const { t, tr } = useI18n();
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
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : t("manageSubscriptionDialog.couldNotSave")),
  });

  const suspendMutation = useMutation({
    mutationFn: (suspended: boolean) =>
      save({ data: { organizationId: company.id, suspended, ...noteField } }),
    onSuccess: (_res, suspended) => {
      toast.success(
        suspended
          ? t("manageSubscriptionDialog.isSuspended", { name: company.name })
          : t("manageSubscriptionDialog.canUseFlasAgain", { name: company.name }),
      );
      refresh();
      setNote("");
    },
    onError: (e) =>
      toast.error(
        e instanceof Error ? e.message : t("manageSubscriptionDialog.couldNotUpdateAccess"),
      ),
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
            <CreditCard className="size-3.5" /> {t("manageSubscriptionDialog.manage")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {tr("manageSubscriptionDialog.subscription", { name: company.name })}
          </DialogTitle>
          <DialogDescription>
            {tr("manageSubscriptionDialog.paidUntil", {
              statusLabel: statusLabel(company.subscription_status),
              paidUntilText: paidUntilText(company, now),
            })}
          </DialogDescription>
        </DialogHeader>

        <div
          className={`rounded-lg border p-3 text-xs ${
            access.allowed ? "" : "border-destructive/40 bg-destructive/5"
          }`}
        >
          <p className="font-medium">
            {access.allowed
              ? t("manageSubscriptionDialog.theyCanUseFlas")
              : t("manageSubscriptionDialog.theyCannotUseFlasRight")}
          </p>
          <p className="text-muted-foreground">{access.reason}</p>
          <p className="mt-1 text-muted-foreground">
            {paddle
              ? t("manageSubscriptionDialog.paysByCardThroughPaddle")
              : t("manageSubscriptionDialog.paysManuallyCashOrBank")}
          </p>
        </div>

        {paddle && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            {t("manageSubscriptionDialog.paddleSetsThisCompanyS")}
          </p>
        )}

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{t("manageSubscriptionDialog.recordAPayment")}</h3>
          <p className="text-xs text-muted-foreground">
            {tr("manageSubscriptionDialog.setsTheStatusToPaid", {
              formatDay: formatDay(base),
              value:
                base === today
                  ? t("manageSubscriptionDialog.today")
                  : t("manageSubscriptionDialog.theirCurrentPaidUntilDate"),
            })}
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
            <Label htmlFor={`plan-${company.id}`}>{t("manageSubscriptionDialog.plan")}</Label>
            <Select value={draft.plan} onValueChange={(plan) => setDraft((d) => ({ ...d, plan }))}>
              <SelectTrigger id={`plan-${company.id}`}>
                <SelectValue placeholder={t("manageSubscriptionDialog.chooseAPlan")} />
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
            <Label htmlFor={`status-${company.id}`}>{t("manageSubscriptionDialog.status")}</Label>
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
            <Label htmlFor={`paid-${company.id}`}>{t("manageSubscriptionDialog.paidUntil2")}</Label>
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
          <Label htmlFor={`note-${company.id}`}>
            {t("manageSubscriptionDialog.noteForTheHistoryOptional")}
          </Label>
          <Input
            id={`note-${company.id}`}
            value={note}
            maxLength={280}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("manageSubscriptionDialog.eGCashAed240")}
          />
        </div>

        <div className="rounded-lg border bg-muted/40 p-3 text-xs">
          {changes.length === 0 ? (
            <p className="text-muted-foreground">{t("manageSubscriptionDialog.noChangesYet")}</p>
          ) : (
            <>
              <p className="mb-1 font-medium">{t("manageSubscriptionDialog.savingWillChange")}</p>
              <ul className="list-disc space-y-0.5 ps-4">
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
            {t("manageSubscriptionDialog.close")}
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
            {t("manageSubscriptionDialog.saveChanges")}
          </Button>
        </div>

        <section className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-semibold">{t("manageSubscriptionDialog.suspend")}</h3>
          <p className="text-xs text-muted-foreground">
            {company.suspended
              ? t("manageSubscriptionDialog.thisCompanyIsSuspendedNobody")
              : t("manageSubscriptionDialog.suspendingCutsOffEveryoneAt")}
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
                    <ShieldCheck className="size-3.5" />{" "}
                    {t("manageSubscriptionDialog.liftSuspension")}
                  </>
                ) : (
                  <>
                    <ShieldOff className="size-3.5" />{" "}
                    {t("manageSubscriptionDialog.suspendCompany")}
                  </>
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {company.suspended
                    ? t("manageSubscriptionDialog.giveAccessAgain", { name: company.name })
                    : t("manageSubscriptionDialog.suspend2", { name: company.name })}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {company.suspended
                    ? t("manageSubscriptionDialog.everyoneAtThisCompanyCan")
                    : t("manageSubscriptionDialog.everyoneAtThisCompanyLoses")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("manageSubscriptionDialog.cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={() => suspendMutation.mutate(!company.suspended)}>
                  {company.suspended
                    ? t("manageSubscriptionDialog.liftSuspension")
                    : t("manageSubscriptionDialog.suspend")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </section>

        <section className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-semibold">{t("manageSubscriptionDialog.history")}</h3>
          {history.isLoading && (
            <p className="text-xs text-muted-foreground">{t("manageSubscriptionDialog.loading")}</p>
          )}
          {history.error && (
            <p className="text-xs text-destructive">
              {history.error instanceof Error
                ? history.error.message
                : t("manageSubscriptionDialog.couldNotLoadHistory")}
            </p>
          )}
          {history.data?.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {t("manageSubscriptionDialog.noSubscriptionChangesRecordedYet")}
            </p>
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
