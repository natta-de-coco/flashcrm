import { useState } from "react";
import { Bell, Check, Loader2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { useI18n } from "@/hooks/useI18n";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SettingsLoadError } from "@/components/settings/SettingsFeedback";
import { listOwnNotifications, markOwnNotificationsRead } from "@/lib/notifications.functions";
import { canReceiveLeadNotifications } from "@/lib/notification-access";
import { toast } from "sonner";
import { formatDateTime, resolveTenantLocale } from "@/lib/locale";

export function WorkspaceNotificationBell() {
  const { user } = useAuth();
  const { tenant, staffRole, loading } = useTenant();
  const { t, language } = useI18n();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const load = useServerFn(listOwnNotifications);
  const mark = useServerFn(markOwnNotificationsRead);
  const enabled = !!user && !!tenant && !loading && canReceiveLeadNotifications(staffRole);
  const key = ["own-notifications", user?.id, tenant?.id];
  const query = useQuery({
    queryKey: key,
    enabled,
    queryFn: () => load(),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const mutation = useMutation({
    mutationFn: (ids: string[]) => mark({ data: { ids } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
    onError: (error: Error) => toast.error(error.message),
  });
  if (!enabled) return null;
  const entries = query.data?.entries ?? [];
  const unread = entries.filter((entry) => !entry.read_at).map((entry) => entry.id);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("settingsWorkspace.notificationBell")}
          className="relative shrink-0"
        >
          <Bell className="size-4" />
          {!query.isError && (query.data?.unreadCount ?? 0) > 0 && (
            <span className="absolute -end-1 -top-1 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {query.data!.unreadCount > 99 ? "99+" : query.data!.unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-0">
        <div className="flex items-center justify-between gap-2 border-b p-3">
          <h2 className="text-sm font-semibold">{t("settingsWorkspace.notificationBell")}</h2>
          {unread.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(unread)}
            >
              {t("settingsWorkspace.markShownRead")}
            </Button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {query.isLoading ? (
            <p role="status" className="flex gap-2 p-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t("settingsWorkspace.loading")}
            </p>
          ) : query.isError ? (
            <SettingsLoadError onRetry={() => void query.refetch()} />
          ) : !entries.length ? (
            <p className="p-3 text-sm text-muted-foreground">
              {t("settingsWorkspace.noNotifications")}
            </p>
          ) : (
            entries.map((entry) => (
              <article
                key={entry.id}
                className={`mb-1 rounded-lg border p-3 ${entry.read_at ? "bg-background" : "bg-primary/5"}`}
              >
                <p className="text-sm font-semibold">{t("settingsWorkspace.newLeadAlert")}</p>
                <p className="mt-1 break-words text-xs text-muted-foreground">{entry.body}</p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <time className="text-[10px] text-muted-foreground">
                    {formatDateTime(
                      entry.created_at,
                      resolveTenantLocale({ timezone: tenant?.timezone, locale: language }),
                    )}
                  </time>
                  {!entry.read_at && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t("settingsWorkspace.markRead")}
                      disabled={mutation.isPending}
                      onClick={() => mutation.mutate([entry.id])}
                    >
                      <Check className="size-3.5" />
                    </Button>
                  )}
                </div>
              </article>
            ))
          )}
        </div>
        <p className="border-t px-3 py-2 text-[10px] text-muted-foreground">
          {t("settingsWorkspace.notificationRefresh")}
        </p>
      </PopoverContent>
    </Popover>
  );
}
