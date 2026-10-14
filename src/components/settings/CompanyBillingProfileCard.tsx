import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { getBillingProfile, saveBillingProfile } from "@/lib/billing.functions";
import {
  billingProfileDraft,
  billingProfilePatch,
  billingProfileProblem,
  EMPTY_BILLING_PROFILE,
  type BillingProfileDraft,
} from "@/lib/settings-billing-profile";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Receipt } from "lucide-react";
import { useMemo } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTenant } from "@/hooks/useTenant";
import { useSettingsDraft } from "@/hooks/useSettingsDraft";
import { isCompanyManager } from "@/lib/permissions";
import { SettingsLoadError, SettingsSaveStatus } from "./SettingsFeedback";
import { toast } from "sonner";
const FIELDS = [
  "tradeName",
  "legalName",
  "trn",
  "regNo",
  "taxLabel",
  "taxRate",
  "phone",
  "email",
  "website",
  "paymentTerms",
  "paymentUrl",
] as const;
const LIMITS = {
  tradeName: 200,
  legalName: 200,
  trn: 80,
  regNo: 80,
  taxLabel: 30,
  phone: 60,
  email: 200,
  website: 200,
  paymentTerms: 300,
  paymentUrl: 500,
};
export function CompanyBillingProfileCard() {
  const { tenant, staffRole } = useTenant();
  const canEdit = isCompanyManager(staffRole);
  const { t } = useI18n();
  const qc = useQueryClient();
  const fetchProfile = useServerFn(getBillingProfile);
  const saveProfile = useServerFn(saveBillingProfile);
  const query = useQuery({
    queryKey: ["company-billing-profile", tenant?.id],
    enabled: !!tenant,
    queryFn: () => fetchProfile(),
  });
  const source = useMemo(
    () =>
      query.data === undefined
        ? undefined
        : billingProfileDraft(query.data as Record<string, unknown> | null),
    [query.data],
  );
  const form = useSettingsDraft("company-billing", tenant?.id ?? "", EMPTY_BILLING_PROFILE, source);
  const problem = billingProfileProblem(form.draft);
  const mutation = useMutation({
    mutationFn: async (draft: BillingProfileDraft) => {
      await saveProfile({ data: billingProfilePatch(draft) });
      return draft;
    },
    onSuccess: (saved) => {
      form.acknowledge(saved);
      toast.success(t("settingsWorkspace.companySaved"));
      void qc.invalidateQueries({ queryKey: ["company-billing-profile", tenant?.id] });
      void qc.invalidateQueries({ queryKey: ["invoice-branding", tenant?.id] });
      void qc.invalidateQueries({ queryKey: ["sales-workspace"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  if (query.isLoading || !tenant) return <Skeleton className="h-64 w-full" />;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Receipt className="size-4 text-primary" />
          {t("settingsWorkspace.companyDetails")}
        </CardTitle>
        <CardDescription>{t("settingsWorkspace.companyDetailsDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isError ? (
          <SettingsLoadError onRetry={() => void query.refetch()} />
        ) : (
          <>
            <fieldset
              disabled={!canEdit || !form.loaded || mutation.isPending}
              className="space-y-4"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {FIELDS.map((key) => (
                  <div className="space-y-1.5" key={key}>
                    <Label htmlFor={`company-${key}`}>{t(`settingsWorkspace.field.${key}`)}</Label>
                    <Input
                      id={`company-${key}`}
                      type={
                        key === "taxRate"
                          ? "number"
                          : key === "email"
                            ? "email"
                            : key === "phone"
                              ? "tel"
                              : "text"
                      }
                      {...(key === "taxRate"
                        ? { min: 0, max: 100, step: 0.1 }
                        : { maxLength: LIMITS[key] })}
                      dir={
                        ["email", "phone", "website", "paymentUrl"].includes(key)
                          ? "ltr"
                          : undefined
                      }
                      value={form.draft[key]}
                      onChange={(event) =>
                        form.setDraft((draft) => ({ ...draft, [key]: event.target.value }))
                      }
                    />
                  </div>
                ))}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="company-address">{t("settingsWorkspace.field.address")}</Label>
                <Textarea
                  id="company-address"
                  rows={3}
                  maxLength={500}
                  value={form.draft.address}
                  onChange={(event) =>
                    form.setDraft((draft) => ({ ...draft, address: event.target.value }))
                  }
                />
              </div>
            </fieldset>
            {problem && form.dirty && (
              <p role="alert" className="text-sm text-destructive">
                {t(`settingsWorkspace.invalid.${problem}`)}
              </p>
            )}
            {canEdit ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <SettingsSaveStatus
                  dirty={form.dirty}
                  onReset={form.reset}
                  disabled={mutation.isPending}
                />
                <Button
                  disabled={!form.loaded || !form.dirty || !!problem || mutation.isPending}
                  onClick={() => mutation.mutate(form.draft)}
                >
                  {t(mutation.isPending ? "settingsWorkspace.saving" : "settingsWorkspace.save")}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{t("settingsWorkspace.adminOnly")}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
