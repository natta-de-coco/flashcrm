import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BellRing, Trash2 } from "lucide-react";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/hooks/useI18n";
import { useTenant } from "@/hooks/useTenant";
import { useSettingsDraft } from "@/hooks/useSettingsDraft";
import {
  getLeadAlertSettings,
  saveLeadAlertSettings,
  type LeadAlertSettingsData,
} from "@/lib/lead-alerts.functions";
import { SettingsLoadError, SettingsSaveStatus } from "./SettingsFeedback";
import { toast } from "sonner";
const EMPTY: LeadAlertSettingsData = {
  leadAlertsEnabled: true,
  alertEmailAddresses: [],
  alertWhatsappEnabled: false,
  alertWhatsappPhone: null,
};
export function LeadAlertsSettingsCard() {
  const { tenant } = useTenant();
  const { t } = useI18n();
  const qc = useQueryClient();
  const load = useServerFn(getLeadAlertSettings);
  const save = useServerFn(saveLeadAlertSettings);
  const query = useQuery({
    queryKey: ["lead_alert_settings", tenant?.id],
    enabled: !!tenant,
    queryFn: () => load(),
  });
  const source = useMemo(() => query.data, [query.data]);
  const form = useSettingsDraft("lead-alerts", tenant?.id ?? "", EMPTY, source);
  const [newEmail, setNewEmail] = useState("");
  const mutation = useMutation({
    mutationFn: async (snapshot: LeadAlertSettingsData) => {
      await save({ data: { ...snapshot, alertWhatsappEnabled: false } });
      return { ...snapshot, alertWhatsappEnabled: false };
    },
    onSuccess: (saved) => {
      form.acknowledge(saved);
      form.setDraft(saved);
      toast.success(t("settingsWorkspace.alertSaved"));
      void qc.invalidateQueries({ queryKey: ["lead_alert_settings", tenant?.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const addEmail = () => {
    const email = newEmail.trim().toLowerCase();
    if (!z.string().email().safeParse(email).success) {
      toast.error(t("settingsWorkspace.invalid.email"));
      return;
    }
    if (form.draft.alertEmailAddresses.includes(email)) {
      toast.error(t("settingsWorkspace.duplicateEmail"));
      return;
    }
    if (form.draft.alertEmailAddresses.length >= 10) {
      toast.error(t("settingsWorkspace.recipientLimit"));
      return;
    }
    form.setDraft((draft) => ({
      ...draft,
      alertEmailAddresses: [...draft.alertEmailAddresses, email],
    }));
    setNewEmail("");
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BellRing className="size-4 text-primary" />
          {t("settingsWorkspace.alertTitle")}
        </CardTitle>
        <CardDescription>{t("settingsWorkspace.alertDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isLoading ? (
          <Skeleton className="h-36 w-full" />
        ) : query.isError ? (
          <SettingsLoadError onRetry={() => void query.refetch()} />
        ) : (
          <>
            <fieldset disabled={!form.loaded || mutation.isPending} className="space-y-5">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="lead-alert-enabled">{t("settingsWorkspace.inAppAlerts")}</Label>
                <Switch
                  id="lead-alert-enabled"
                  checked={form.draft.leadAlertsEnabled}
                  onCheckedChange={(enabled) =>
                    form.setDraft((draft) => ({ ...draft, leadAlertsEnabled: enabled }))
                  }
                />
              </div>
              <div
                className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-sm"
                role="status"
              >
                {t("settingsWorkspace.alertDeliveryLimited")}
              </div>
              <div className="space-y-3">
                <Label htmlFor="lead-alert-email">{t("settingsWorkspace.alertRecipients")}</Label>
                <div className="flex gap-2">
                  <Input
                    id="lead-alert-email"
                    type="email"
                    dir="ltr"
                    autoComplete="email"
                    value={newEmail}
                    onChange={(event) => setNewEmail(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addEmail();
                      }
                    }}
                  />
                  <Button variant="outline" onClick={addEmail} disabled={!newEmail.trim()}>
                    {t("settingsWorkspace.add")}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {form.draft.alertEmailAddresses.map((email) => (
                    <Badge key={email} variant="secondary" className="gap-2">
                      <span dir="ltr">{email}</span>
                      <button
                        type="button"
                        aria-label={t("settingsWorkspace.removeRecipient", { email })}
                        onClick={() =>
                          form.setDraft((draft) => ({
                            ...draft,
                            alertEmailAddresses: draft.alertEmailAddresses.filter(
                              (item) => item !== email,
                            ),
                          }))
                        }
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
              {form.draft.alertWhatsappEnabled && (
                <div className="rounded-lg border border-destructive/25 p-3">
                  <p className="mb-2 text-sm">{t("settingsWorkspace.legacyWaAlert")}</p>
                  <Button
                    variant="outline"
                    onClick={() =>
                      form.setDraft((draft) => ({ ...draft, alertWhatsappEnabled: false }))
                    }
                  >
                    {t("settingsWorkspace.disableWaAlert")}
                  </Button>
                </div>
              )}
            </fieldset>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SettingsSaveStatus
                dirty={form.dirty}
                onReset={form.reset}
                disabled={mutation.isPending}
              />
              <Button
                disabled={
                  !form.loaded ||
                  !form.dirty ||
                  mutation.isPending ||
                  form.draft.alertWhatsappEnabled
                }
                onClick={() => mutation.mutate(form.draft)}
              >
                {t(mutation.isPending ? "settingsWorkspace.saving" : "settingsWorkspace.save")}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
