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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Bot, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

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
  { id: "google/gemini-3.7-flash", label: "Fast (Gemini 3.7 Flas)" },
  { id: "google/gemini-3.1-pro-preview", label: "Smartest (Gemini 3.1 Pro)" },
  { id: "google/gemini-3.1-flash-lite", label: "Cheapest (Gemini 3.1 Flas Lite)" },
];

function ChatbotPage() {
  const qc = useQueryClient();
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
    queryKey: ["bot_settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("bot_settings").select("*").maybeSingle();
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

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("bot_settings").update({
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
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Chatbot updated");
      void qc.invalidateQueries({ queryKey: ["bot_settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-6">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Bot className="size-6 text-brand" /> AI chatbot
        </h1>
        <p className="text-sm text-muted-foreground">
          The assistant answers WhatsApp and website chats automatically, then hands off to a human
          when needed.
        </p>
      </header>

      <div className="grid max-w-3xl gap-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Auto-reply</CardTitle>
              <CardDescription>Reply instantly to new incoming messages.</CardDescription>
            </div>
            <Switch
              checked={form.enabled}
              onCheckedChange={(v) => setForm({ ...form, enabled: v })}
            />
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Personality</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="bot_name">Bot name</Label>
              <Input
                id="bot_name"
                value={form.bot_name}
                onChange={(e) => setForm({ ...form, bot_name: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="greeting">First greeting</Label>
              <Textarea
                id="greeting"
                rows={2}
                value={form.greeting}
                onChange={(e) => setForm({ ...form, greeting: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="instructions">Instructions / knowledge</Label>
              <Textarea
                id="instructions"
                rows={8}
                value={form.instructions}
                onChange={(e) => setForm({ ...form, instructions: e.target.value })}
                placeholder="Describe your business, products, pricing, opening hours and tone of voice."
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Model</Label>
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
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Human handoff</CardTitle>
            <CardDescription>
              When a contact uses one of these words, the bot stops and an agent takes over.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="handoff">Handoff keywords (comma separated)</Label>
              <Input
                id="handoff"
                value={form.handoff_keywords}
                onChange={(e) => setForm({ ...form, handoff_keywords: e.target.value })}
                placeholder="human, agent, complaint, refund"
              />
            </div>
            <label className="flex items-center gap-3 text-sm">
              <Switch
                checked={form.business_hours_only}
                onCheckedChange={(v) => setForm({ ...form, business_hours_only: v })}
              />
              Only auto-reply outside of agent availability
            </label>
          </CardContent>
        </Card>

        <div>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            <Save className="size-4" /> Save chatbot
          </Button>
        </div>
      </div>
    </main>
  );
}
