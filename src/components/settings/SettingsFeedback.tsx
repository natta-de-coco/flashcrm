import { AlertCircle, Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/useI18n";

export function SettingsLoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/25 bg-destructive/5 p-4"
    >
      <AlertCircle className="size-4 shrink-0 text-destructive" />
      <p className="min-w-0 flex-1 text-sm">{t("settingsWorkspace.loadError")}</p>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        {t("settingsWorkspace.retry")}
      </Button>
    </div>
  );
}

export function SettingsSaveStatus({
  dirty,
  onReset,
  disabled = false,
}: {
  dirty: boolean;
  onReset: () => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground"
      role="status"
    >
      {!dirty && <Check className="size-3.5 text-primary" />}
      {t(dirty ? "settingsWorkspace.unsaved" : "settingsWorkspace.saved")}
      {dirty && (
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onReset}>
          <RotateCcw className="size-3.5" />
          {t("settingsWorkspace.reset")}
        </Button>
      )}
    </div>
  );
}
