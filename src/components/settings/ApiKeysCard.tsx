import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createApiKey, listApiKeys, revokeApiKey } from "@/lib/api-keys.functions";
import { API_SCOPES, SCOPE_LABELS, type ApiScope } from "@/lib/api-scopes";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { formatDayUnambiguous } from "@/lib/locale";
import { useI18n } from "@/hooks/useI18n";

/** Admin UI for tenant-scoped API keys with per-key permissions. */
export function ApiKeysCard({ origin }: { origin: string }) {
  const { t, tr } = useI18n();
  const qc = useQueryClient();
  const listFn = useServerFn(listApiKeys);
  const createFn = useServerFn(createApiKey);
  const revokeFn = useServerFn(revokeApiKey);

  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiScope[]>(["leads:read"]);
  const [freshKey, setFreshKey] = useState<string | null>(null);

  const keys = useQuery({ queryKey: ["api-keys"], queryFn: () => listFn() });

  const create = useMutation({
    mutationFn: () => createFn({ data: { name: name.trim(), scopes } }),
    onSuccess: (res) => {
      setFreshKey(res.rawKey);
      setName("");
      toast.success(t("settings.api.createdToast"));
      void qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revoke = useMutation({
    mutationFn: (keyId: string) => revokeFn({ data: { keyId } }),
    onSuccess: () => {
      toast.success(t("settings.api.revokedToast"));
      void qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function toggleScope(scope: ApiScope) {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("settings.api.title")}</CardTitle>
        <CardDescription>
          {tr("settings.api.desc", {
            endpoint: <code className="rounded bg-muted px-1">{origin}/api/public/v1/leads</code>,
            header: <code className="rounded bg-muted px-1">Authorization: Bearer flas_…</code>,
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 rounded-lg border p-3">
          <div className="grid gap-1.5">
            <Label htmlFor="key_name">{t("settings.api.keyName")}</Label>
            <Input
              id="key_name"
              placeholder={t("settings.api.keyNamePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-3">
            {API_SCOPES.map((scope) => (
              <label key={scope} className="flex items-center gap-1.5 text-xs font-medium">
                <input
                  type="checkbox"
                  checked={scopes.includes(scope)}
                  onChange={() => toggleScope(scope)}
                />
                {t(`settings.api.scope.${scope}`)}
              </label>
            ))}
          </div>
          <div>
            <Button
              disabled={name.trim().length < 2 || scopes.length === 0 || create.isPending}
              onClick={() => create.mutate()}
            >
              <Plus className="size-4" /> {t("settings.api.create")}
            </Button>
          </div>
          {freshKey && (
            <div className="grid gap-1.5 rounded-md border border-brand/40 bg-brand/5 p-3">
              <Label>{t("settings.api.newKey")}</Label>
              <div className="flex gap-2">
                <Input readOnly value={freshKey} className="font-mono text-xs" />
                <Button
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(freshKey);
                    toast.success(t("settings.api.copied"));
                  }}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-2">
          {(keys.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">{t("settings.api.none")}</p>
          )}
          {(keys.data ?? []).map((k) => (
            <div
              key={k.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <KeyRound className="size-3.5" />
                  {k.name}
                  <code className="text-xs font-normal text-muted-foreground">{k.prefix}…</code>
                  {k.revoked_at && <Badge variant="destructive">{t("settings.api.revoked")}</Badge>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {(k.scopes ?? []).join(", ")}
                  {k.last_used_at
                    ? ` · ${t("settings.api.lastUsed", { date: formatDayUnambiguous(k.last_used_at) })}`
                    : ` · ${t("settings.api.neverUsed")}`}
                </p>
              </div>
              {!k.revoked_at && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => revoke.mutate(k.id)}
                  disabled={revoke.isPending}
                >
                  <Trash2 className="size-3.5" /> {t("settings.api.revoke")}
                </Button>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
