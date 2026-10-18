import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { useSettingsDraft } from "@/hooks/useSettingsDraft";
import { getOwnProfileSettings, saveOwnProfileSettings } from "@/lib/profile-settings.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsLoadError, SettingsSaveStatus } from "./SettingsFeedback";
import { toast } from "sonner";

const EMPTY = { fullName: "" };
export function PersonalProfileCard() {
  const { user } = useAuth();
  const { t } = useI18n();
  const qc = useQueryClient();
  const load = useServerFn(getOwnProfileSettings);
  const save = useServerFn(saveOwnProfileSettings);
  const profile = useQuery({
    queryKey: ["personal-profile", user?.id],
    enabled: !!user,
    queryFn: () => load(),
  });
  const source = useMemo(() => profile.data, [profile.data]);
  const form = useSettingsDraft("profile", user?.id ?? "", EMPTY, source);
  const mutation = useMutation({
    mutationFn: (value: typeof EMPTY) => save({ data: value }),
    onSuccess: (saved) => {
      form.acknowledge(saved);
      form.setDraft(saved);
      qc.setQueryData(["personal-profile", user?.id], saved);
      void qc.invalidateQueries({ queryKey: ["team"] });
      toast.success(t("settingsWorkspace.profileSaved"));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settingsWorkspace.profile.label")}</CardTitle>
        <CardDescription>{t("settingsWorkspace.profile.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {profile.isLoading ? (
          <Skeleton className="h-36 w-full" />
        ) : profile.isError ? (
          <SettingsLoadError onRetry={() => void profile.refetch()} />
        ) : (
          <>
            <fieldset
              disabled={!form.loaded || mutation.isPending}
              className="grid gap-4 sm:grid-cols-2"
            >
              <div className="space-y-2">
                <Label htmlFor="personal-full-name">{t("settingsWorkspace.fullName")}</Label>
                <Input
                  id="personal-full-name"
                  maxLength={120}
                  autoComplete="name"
                  value={form.draft.fullName}
                  onChange={(event) => form.setDraft({ fullName: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="personal-email">{t("settingsWorkspace.email")}</Label>
                <Input
                  id="personal-email"
                  type="email"
                  dir="ltr"
                  readOnly
                  value={user?.email ?? ""}
                />
                <p className="text-xs text-muted-foreground">
                  {t("settingsWorkspace.emailReadOnly")}
                </p>
              </div>
            </fieldset>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SettingsSaveStatus
                dirty={form.dirty}
                onReset={form.reset}
                disabled={mutation.isPending}
              />
              <Button
                disabled={!form.loaded || !form.dirty || mutation.isPending}
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
