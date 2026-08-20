import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { draftBotReply, sendAgentMessage } from "@/lib/crm.functions";
import type { Conversation, Message } from "@/lib/crm-types";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Bot, Globe, Loader2, Search, Send, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/inbox")({
  head: () => ({
    meta: [
      { title: "Inbox — Flas CRM" },
      { name: "description", content: "Monitor and reply to WhatsApp and website chats live." },
      { property: "og:title", content: "Inbox — Flas CRM" },
      { property: "og:description", content: "Live shared inbox for WhatsApp and website chats." },
    ],
  }),
  component: InboxPage,
});

function InboxPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "pending" | "closed">("all");
  const bottomRef = useRef<HTMLDivElement>(null);

  const send = useServerFn(sendAgentMessage);
  const suggest = useServerFn(draftBotReply);

  const conversations = useQuery({
    queryKey: ["conversations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("*, contacts(id, name, phone, company, stage)")
        .order("last_message_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as unknown as Conversation[];
    },
  });

  const messages = useQuery({
    queryKey: ["messages", activeId],
    enabled: Boolean(activeId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", activeId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as unknown as Message[];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("inbox-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
        void qc.invalidateQueries({ queryKey: ["messages"] });
        void qc.invalidateQueries({ queryKey: ["conversations"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => {
        void qc.invalidateQueries({ queryKey: ["conversations"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.data?.length, activeId]);

  const list = useMemo(() => {
    const all = conversations.data ?? [];
    return all.filter((c) => {
      const matchesStatus = statusFilter === "all" || c.status === statusFilter;
      const q = search.trim().toLowerCase();
      const matchesSearch =
        !q ||
        c.contacts?.name?.toLowerCase().includes(q) ||
        c.contacts?.phone?.includes(q) ||
        c.last_message_preview?.toLowerCase().includes(q);
      return matchesStatus && Boolean(matchesSearch);
    });
  }, [conversations.data, statusFilter, search]);

  const active = list.find((c) => c.id === activeId) ?? null;

  useEffect(() => {
    if (!activeId && list.length) setActiveId(list[0]!.id);
  }, [activeId, list]);

  useEffect(() => {
    if (!activeId) return;
    void supabase.from("conversations").update({ unread_count: 0 }).eq("id", activeId);
  }, [activeId]);

  const sendMutation = useMutation({
    mutationFn: async (body: string) => send({ data: { conversationId: activeId!, body } }),
    onSuccess: (res) => {
      setDraft("");
      if (res.deliveryError) toast.warning(`Saved, but not delivered: ${res.deliveryError}`);
      void qc.invalidateQueries({ queryKey: ["messages", activeId] });
      void qc.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const suggestMutation = useMutation({
    mutationFn: async () => suggest({ data: { conversationId: activeId! } }),
    onSuccess: (res) => setDraft(res.draft),
    onError: (e: Error) => toast.error(e.message),
  });

  type ConvPatch = {
    bot_enabled?: boolean;
    status?: "open" | "pending" | "closed";
    assigned_to?: string | null;
  };

  async function updateConversation(patch: ConvPatch) {
    if (!activeId) return;
    const { error } = await supabase.from("conversations").update(patch).eq("id", activeId);
    if (error) toast.error(error.message);
    else void qc.invalidateQueries({ queryKey: ["conversations"] });
  }

  return (
    <div className="flex h-[calc(100vh-0px)] min-h-0 flex-1">
      {/* Conversation list */}
      <div className="flex w-full max-w-sm shrink-0 flex-col border-r bg-card">
        <div className="space-y-3 border-b p-4">
          <h1 className="text-lg font-bold">Inbox</h1>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search chats"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-1">
            {(["all", "open", "pending", "closed"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors",
                  statusFilter === s
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-secondary",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {conversations.isLoading && (
            <p className="p-4 text-sm text-muted-foreground">Loading conversations…</p>
          )}
          {!conversations.isLoading && list.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">
              No conversations yet. Messages from WhatsApp and the website widget land here.
            </p>
          )}
          {list.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveId(c.id)}
              className={cn(
                "flex w-full flex-col gap-1 border-b px-4 py-3 text-left transition-colors hover:bg-muted/60",
                activeId === c.id && "bg-secondary",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold">
                  {c.contacts?.name ?? "Unknown"}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {new Date(c.last_message_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <span className="truncate text-xs text-muted-foreground">
                {c.last_message_preview ?? "No messages yet"}
              </span>
              <div className="flex items-center gap-1.5 pt-1">
                <Badge variant="secondary" className="gap-1 text-[10px]">
                  {c.channel === "web" ? <Globe className="size-3" /> : null}
                  {c.channel === "web" ? "Website" : "WhatsApp"}
                </Badge>
                {c.bot_enabled && (
                  <Badge className="gap-1 bg-brand text-brand-foreground text-[10px]">
                    <Bot className="size-3" /> Bot
                  </Badge>
                )}
                {c.unread_count > 0 && (
                  <Badge variant="destructive" className="text-[10px]">
                    {c.unread_count}
                  </Badge>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Chat pane */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!active ? (
          <div className="grid flex-1 place-items-center text-sm text-muted-foreground">
            Select a conversation to start monitoring.
          </div>
        ) : (
          <>
            <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-5 py-3">
              <div className="min-w-0">
                <h2 className="truncate font-semibold">{active.contacts?.name}</h2>
                <p className="truncate text-xs text-muted-foreground">
                  {active.contacts?.phone ?? "Website visitor"}
                  {active.contacts?.company ? ` · ${active.contacts.company}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs font-medium">
                  <Switch
                    checked={active.bot_enabled}
                    onCheckedChange={(v) => void updateConversation({ bot_enabled: v })}
                  />
                  AI auto-reply
                </label>
                <div className="flex gap-1">
                  {(["open", "pending", "closed"] as const).map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      variant={active.status === s ? "default" : "outline"}
                      onClick={() => void updateConversation({ status: s })}
                      className="capitalize"
                    >
                      {s}
                    </Button>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    void updateConversation({
                      assigned_to: active.assigned_to === user?.id ? null : (user?.id ?? null),
                    })
                  }
                >
                  {active.assigned_to === user?.id ? "Unassign me" : "Assign to me"}
                </Button>
              </div>
            </header>

            <div className="chat-canvas-bg min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
              {(messages.data ?? []).map((m) => (
                <div
                  key={m.id}
                  className={cn("flex", m.direction === "outbound" ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[70%] rounded-2xl px-4 py-2 text-sm shadow-panel",
                      m.direction === "outbound"
                        ? "bg-bubble-out text-bubble-out-foreground"
                        : "bg-bubble-in text-bubble-in-foreground",
                    )}
                  >
                    {m.sender === "bot" && (
                      <span className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide opacity-70">
                        <Bot className="size-3" /> Assistant
                      </span>
                    )}
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                    <span className="mt-1 block text-right text-[10px] opacity-60">
                      {new Date(m.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            <div className="space-y-2 border-t bg-card p-4">
              <Textarea
                rows={2}
                placeholder="Write a reply…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && draft.trim()) {
                    e.preventDefault();
                    sendMutation.mutate(draft.trim());
                  }
                }}
              />
              <div className="flex items-center justify-between">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => suggestMutation.mutate()}
                  disabled={suggestMutation.isPending}
                >
                  {suggestMutation.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  Suggest reply
                </Button>
                <Button
                  onClick={() => draft.trim() && sendMutation.mutate(draft.trim())}
                  disabled={sendMutation.isPending || !draft.trim()}
                >
                  <Send className="size-4" />
                  Send
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
