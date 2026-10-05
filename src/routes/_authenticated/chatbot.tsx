import { WebsiteKnowledgeCard } from "@/components/WebsiteKnowledgeCard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, Bot, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/hooks/useI18n";

export const Route = createFileRoute("/_authenticated/chatbot")({
  head: () => ({
    meta: [
      { title: "AI Chatbot — Flas CRM" },
      {
        name: "description",
        content: "Configure your AI WhatsApp and website chatbot, greeting and handoff rules.",
      },
      { property: "og:title", content: "AI Chatbot — Flas CRM" },
      {
        property: "og:description",
        content: "Configure your AI WhatsApp and website chatbot, greeting and handoff rules.",
      },
    ],
  }),
  component: ChatbotPage,
});

const MODELS = [
  { id: "google/gemini-3.7-flash", label: "Quick replies" },
  { id: "google/gemini-3.1-pro-preview", label: "More detailed reasoning" },
  { id: "google/gemini-3.1-flash-lite", label: "Lower cost" },
];

function ChatbotPage() {
  const { t, tr } = useI18n();
  const qc = useQueryClient();
  const { tenant } = useTenant();
  const [form, setForm] = useState({
    enabled: true,
    bot_name: "Assistant",
    greeting: "",
    instructions: "",
    model: MODELS[0]!.id,
    business_hours_only: false,
    handoff_keywords: "",
  });

  const settings = useQuery({
    queryKey: ["tenant_bot_settings", tenant?.id],
    enabled: !!tenant?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_bot_settings")
        .select("*")
        .eq("tenant_id", tenant!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    const s = settings.data;
    if (!s) return;
    setForm({
      enabled: s.enabled,
      bot_name: s.bot_name,
      greeting: s.greeting,
      instructions: s.instructions,
      model: s.model,
      business_hours_only: s.business_hours_only,
      handoff_keywords: (s.handoff_keywords ?? []).join(", "),
    });
  }, [settings.data]);

  const instructionsTrimmed = form.instructions.trim();
  const greetingTrimmed = form.greeting.trim();
  const instructionsValid = instructionsTrimmed.length >= 20;
  const greetingValid = greetingTrimmed.length > 0;
  const isDormant = form.enabled && (!instructionsValid || !greetingValid);

  const save = useMutation({
    mutationFn: async () => {
      if (!tenant?.id) throw new Error("Your workspace is still being set up.");
      const { error } = await supabase.from("tenant_bot_settings").upsert(
        {
          tenant_id: tenant.id,
          enabled: form.enabled,
          bot_name: form.bot_name,
          greeting: form.greeting,
          instructions: form.instructions,
          model: form.model,
          business_hours_only: form.business_hours_only,
          handoff_keywords: form.handoff_keywords
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean),
        },
        { onConflict: "tenant_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      if (isDormant) {
        toast.warning(t("chatbot.chatbotSavedButAutoReply"));
      } else {
        toast.success(t("chatbot.chatbotUpdated"));
      }
      void qc.invalidateQueries({ queryKey: ["tenant_bot_settings", tenant?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-6">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Bot className="size-6 text-brand" /> {t("chatbot.aiChatbot")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("chatbot.theAssistantAnswersWhatsappAnd")}
        </p>
      </header>

      <div className="grid max-w-3xl gap-4">
        <WebsiteKnowledgeCard />
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base" id="auto-reply-title">
                  {t("chatbot.autoReply")}
                </CardTitle>
                {form.enabled && (
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      isDormant
                        ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                        : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    }`}
                  >
                    {isDormant ? t("chatbot.dormant") : t("chatbot.active")}
                  </span>
                )}
              </div>
              <CardDescription id="auto-reply-desc">
                {t("chatbot.replyInstantlyToNewIncoming")}
              </CardDescription>
            </div>
            <Switch
              aria-labelledby="auto-reply-title"
              aria-describedby="auto-reply-desc"
              checked={form.enabled}
              onCheckedChange={(v) => setForm({ ...form, enabled: v })}
            />
          </CardHeader>
        </Card>

        {isDormant && (
          <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
            <AlertTitle className="font-semibold text-amber-800 dark:text-amber-300">
              {t("chatbot.autoReplyIsDormant")}
            </AlertTitle>
            <AlertDescription className="text-amber-800/90 dark:text-amber-300/90 text-xs sm:text-sm">
              {t("chatbot.evenThoughTheAutoReply")}
              <ul className="mt-1.5 list-disc ps-4 space-y-0.5">
                {!instructionsValid && (
                  <li>
                    {t("chatbot.instructionsMustBeAtLeast", { length: instructionsTrimmed.length })}
                  </li>
                )}
                {!greetingValid && <li>{t("chatbot.aFirstGreetingMessageIs")}</li>}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("chatbot.personality")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="bot_name">{t("chatbot.botName")}</Label>
              <Input
                id="bot_name"
                value={form.bot_name}
                onChange={(e) => setForm({ ...form, bot_name: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="greeting">{t("chatbot.firstGreeting")}</Label>
                {form.enabled && !greetingValid && (
                  <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                    {t("chatbot.requiredForAutoReply")}
                  </span>
                )}
              </div>
              <Textarea
                id="greeting"
                rows={2}
                value={form.greeting}
                onChange={(e) => setForm({ ...form, greeting: e.target.value })}
                placeholder={t("chatbot.eGHiThereThanks")}
                className={
                  form.enabled && !greetingValid
                    ? "border-amber-500/50 focus-visible:ring-amber-500"
                    : ""
                }
              />
            </div>
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="instructions">{t("chatbot.instructionsKnowledge")}</Label>
                <span
                  className={`text-xs font-medium ${instructionsValid ? "text-muted-foreground" : form.enabled ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-muted-foreground"}`}
                >
                  {tr("chatbot.20MinChars", { length: instructionsTrimmed.length })}
                </span>
              </div>
              <Textarea
                id="instructions"
                rows={8}
                value={form.instructions}
                onChange={(e) => setForm({ ...form, instructions: e.target.value })}
                placeholder={t("chatbot.tellUsWhatYouSell")}
                className={
                  form.enabled && !instructionsValid
                    ? "border-amber-500/50 focus-visible:ring-amber-500"
                    : ""
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("chatbot.model")}</Label>
              <Select value={form.model} onValueChange={(v) => setForm({ ...form, model: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODELS.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {tr("chatbot.customerRepliesUseFlasAi", {
                  link: (
                    <Link to="/catalog" className="underline">
                      {t("chatbot.catalog")}
                    </Link>
                  ),
                })}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("chatbot.humanHandoff")}</CardTitle>
            <CardDescription>{t("chatbot.requestsForAPersonAnd")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="handoff">{t("chatbot.handoffKeywordsCommaSeparated")}</Label>
              <Input
                id="handoff"
                value={form.handoff_keywords}
                onChange={(e) => setForm({ ...form, handoff_keywords: e.target.value })}
                placeholder={t("chatbot.humanAgentComplaintRefund")}
              />
            </div>
            <label className="flex items-center gap-3 text-sm">
              <Switch checked={false} disabled />
              {t("chatbot.availabilityBasedSchedulingComingSoon")}
            </label>
          </CardContent>
        </Card>

        <div>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            <Save className="size-4" /> {t("chatbot.saveChatbot")}
          </Button>
        </div>
      </div>
    </main>
  );
}
