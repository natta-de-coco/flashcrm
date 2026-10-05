import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTenant } from "@/hooks/useTenant";
import {
  AI_PROVIDERS,
  deleteAiKey,
  listAiKeys,
  saveAiKey,
  checkAiProvider,
  getAiResilience,
  setAiResilience,
} from "@/lib/ai-keys.functions";
import { isCompanyManager } from "@/lib/permissions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, KeyRound, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

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
  const { staffRole, tenant } = useTenant();
  const canManage = isCompanyManager(staffRole);
  const qc = useQueryClient();

  const load = useServerFn(listAiKeys);
  const save = useServerFn(saveAiKey);
  const remove = useServerFn(deleteAiKey);
  const check = useServerFn(checkAiProvider);
  const loadResilience = useServerFn(getAiResilience);
  const saveResilience = useServerFn(setAiResilience);
  const [health, setHealth] = useState<
    Record<string, { ok: boolean; message: string; testedAt: string }>
  >({});
  useEffect(() => setHealth({}), [tenant?.id]);
  const resilience = useQuery({
    queryKey: ["ai-resilience", tenant?.id],
    queryFn: () => loadResilience(),
    enabled: canManage,
  });
  const testing = useMutation({
    mutationFn: (p: ProviderId | "platform") => check({ data: { provider: p } }),
    onSuccess: (result, p) => setHealth((previous) => ({ ...previous, [p]: result })),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not test the provider"),
  });
  const backups = useMutation({
    mutationFn: (enabled: boolean) => saveResilience({ data: { enabled } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["ai-resilience"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not save backup settings"),
  });

  const [provider, setProvider] = useState<ProviderId>("openai");
  const [apiKey, setApiKey] = useState("");

  useEffect(() => setApiKey(""), [tenant?.id]);
  const keys = useQuery({
    queryKey: ["ai-keys", tenant?.id],
    queryFn: () => load(),
    enabled: canManage,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["ai-keys"] });

  const saving = useMutation({
    mutationFn: () => save({ data: { provider, apiKey: apiKey.trim() } }),
    onSuccess: () => {
      toast.success("Key saved. Test the connection before relying on it.");
      setHealth((previous) => {
        const next = { ...previous };
        delete next[provider];
        return next;
      });
      setApiKey("");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save the key"),
  });

  const removing = useMutation({
    mutationFn: (p: ProviderId) => remove({ data: { provider: p } }),
    onSuccess: () => {
      toast.success("Key removed. The newest remaining key, or built-in Flas AI, will be used.");
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not remove the key"),
  });

  const configured = keys.data ?? [];
  const spec = AI_PROVIDERS.find((p) => p.id === provider)!;

  return (
    <Card id="ai-keys" className="scroll-mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-brand" /> Your own AI keys
          {configured.length > 0 && <Badge variant="secondary">{configured.length}</Badge>}
        </CardTitle>
        <CardDescription>
          Add OpenAI, Claude or Gemini. The most recently saved active provider is tried first. A
          saved key is not a connection test. Provider billing and limits still apply.
        </CardDescription>
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
                      <Badge variant="secondary" className="ml-2 text-[10px]">
                        saved · not a health check
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Added {new Date(k.created_at).toLocaleDateString()} · key hidden for safety
                  </p>
                  {health[k.provider] && (
                    <p role="status" className="text-xs">
                      {health[k.provider]!.message} Checked{" "}
                      {new Date(health[k.provider]!.testedAt).toLocaleTimeString()}.
                    </p>
                  )}
                </div>
                {canManage && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={testing.isPending}
                    onClick={() => testing.mutate(k.provider as ProviderId)}
                  >
                    Test connection
                  </Button>
                )}
                {canManage && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 gap-1 text-xs text-destructive hover:text-destructive"
                    disabled={removing.isPending}
                    onClick={() => removing.mutate(k.provider as ProviderId)}
                  >
                    <Trash2 className="size-3.5" /> Remove
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {canManage && (
          <div className="grid gap-2 rounded-lg border p-3">
            <Label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={resilience.data?.enabled ?? false}
                disabled={!resilience.data?.available || backups.isPending}
                onChange={(event) => backups.mutate(event.target.checked)}
              />
              Use backup AI when the primary provider fails
            </Label>
            <p className="text-xs text-muted-foreground">
              With backups enabled, the same prompt and business context may go to your other saved
              providers, newest first, then built-in Flas AI. Their usage charges apply. Workspace
              limits still apply, and safety refusals are never retried with another provider.
            </p>
            {resilience.data && !resilience.data.available && (
              <p role="alert" className="text-xs">
                Backup settings need the AI database migration. Ask your platform admin to finish
                setup.
              </p>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={testing.isPending}
              onClick={() => testing.mutate("platform")}
            >
              Test built-in AI
            </Button>
            {health["platform"] && (
              <p role="status" className="text-xs">
                {health["platform"].message}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Tests send only a short test prompt, not customer conversations.
            </p>
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
              <Label htmlFor="ai-key">API key</Label>
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
                  Open <ExternalLink className="size-3" />
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
                {configured.some((k) => k.provider === provider) ? "Replace key" : "Save key"}
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              New and replaced keys are encrypted before storage and never returned to your browser.
              To change a key, paste its replacement here.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Only a company admin can add or change AI keys.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
