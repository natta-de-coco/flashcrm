import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTenant } from "@/hooks/useTenant";
import { AI_PROVIDERS, deleteAiKey, listAiKeys, saveAiKey } from "@/lib/ai-keys.functions";
import { isCompanyManager } from "@/lib/permissions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, KeyRound, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/hooks/useI18n";

type ProviderId = (typeof AI_PROVIDERS)[number]["id"];

/**
 * Bring-your-own AI keys.
 *
 * The backend has read a tenant's own key for a while and the marketing site
 * advertises it, but there was no way to enter one — so every workspace ran on
 * the shared platform key whatever it had been told. This is the missing
 * screen.
 *
 * Keys are write-only from the browser by design: the column is not readable
 * with an ordinary session, so this shows which providers are configured and
 * when, never the key itself. Replacing one means pasting it again, which is
 * the correct trade.
 */
export function AiKeysCard() {
  const { t, tr } = useI18n();
  const { staffRole } = useTenant();
  const canManage = isCompanyManager(staffRole);
  const qc = useQueryClient();

  const load = useServerFn(listAiKeys);
  const save = useServerFn(saveAiKey);
  const remove = useServerFn(deleteAiKey);

  const [provider, setProvider] = useState<ProviderId>("openai");
  const [apiKey, setApiKey] = useState("");

  const keys = useQuery({ queryKey: ["ai-keys"], queryFn: () => load() });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["ai-keys"] });

  const saving = useMutation({
    mutationFn: () => save({ data: { provider, apiKey: apiKey.trim() } }),
    onSuccess: () => {
      toast.success(t("aiKeysCard.keySavedFlasAiWill"));
      setApiKey("");
      refresh();
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : t("aiKeysCard.couldNotSaveTheKey")),
  });

  const removing = useMutation({
    mutationFn: (p: ProviderId) => remove({ data: { provider: p } }),
    onSuccess: () => {
      toast.success(t("aiKeysCard.keyRemovedRevertingToThe"));
      refresh();
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : t("aiKeysCard.couldNotRemoveTheKey")),
  });

  const configured = keys.data ?? [];
  const spec = AI_PROVIDERS.find((p) => p.id === provider)!;

  return (
    <Card id="ai-keys" className="scroll-mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-brand" /> {t("aiKeysCard.yourOwnAiKeys")}
          {configured.length > 0 && <Badge variant="secondary">{configured.length}</Badge>}
        </CardTitle>
        <CardDescription>{t("aiKeysCard.flasAiWorksWithoutThis")}</CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4">
        {configured.length > 0 && (
          <div className="grid gap-2">
            {configured.map((k) => (
              <div
                key={k.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  {/* A Badge renders a div, and a div inside a p is invalid
                      HTML that React reports as a hydration error on every
                      render of this page. */}
                  <div className="text-sm font-medium">
                    {AI_PROVIDERS.find((p) => p.id === k.provider)?.name ?? k.provider}
                    {k.active && (
                      <Badge variant="secondary" className="ms-2 text-[10px]">
                        {t("aiKeysCard.inUse")}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {tr("aiKeysCard.addedKeyHiddenForSafety", {
                      toLocaleDateString: new Date(k.created_at).toLocaleDateString(),
                    })}
                  </p>
                </div>
                {canManage && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 gap-1 text-xs text-destructive hover:text-destructive"
                    disabled={removing.isPending}
                    onClick={() => removing.mutate(k.provider as ProviderId)}
                  >
                    <Trash2 className="size-3.5" /> {t("aiKeysCard.remove")}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {canManage ? (
          <div className="grid gap-3 rounded-lg border border-dashed p-3">
            <div className="flex flex-wrap gap-1.5">
              {AI_PROVIDERS.map((p) => (
                <Button
                  key={p.id}
                  type="button"
                  size="sm"
                  variant={provider === p.id ? "default" : "outline"}
                  onClick={() => setProvider(p.id)}
                >
                  {p.name}
                </Button>
              ))}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="ai-key">{t("aiKeysCard.apiKey")}</Label>
              <Input
                id="ai-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={
                  provider === "openai" ? "sk-…" : provider === "google" ? "AIza…" : "sk-ant-…"
                }
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {spec.hint}{" "}
                <a
                  href={spec.keysUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-0.5 text-brand underline underline-offset-2"
                >
                  {t("aiKeysCard.open")} <ExternalLink className="size-3" />
                </a>
              </p>
            </div>

            <div>
              <Button
                size="sm"
                className="gap-1.5"
                disabled={apiKey.trim().length < 20 || saving.isPending}
                onClick={() => saving.mutate()}
              >
                <KeyRound className="size-3.5" />
                {configured.some((k) => k.provider === provider)
                  ? t("aiKeysCard.replaceKey")
                  : t("aiKeysCard.saveKey")}
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              {t("aiKeysCard.storedEncryptedAtRestAnd")}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("aiKeysCard.onlyACompanyAdminCan")}</p>
        )}
      </CardContent>
    </Card>
  );
}
