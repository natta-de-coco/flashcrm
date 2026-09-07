import { SocialInbox } from "@/components/inbox/SocialInbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { recordAuditEvent } from "@/lib/audit.functions";
import {
  buildCatalogMessage,
  draftBotReply,
  sendAgentMessage,
  sendTemplateMessage,
  translateMessage,
} from "@/lib/crm.functions";
import type { Conversation, Message } from "@/lib/crm-types";
import { supabase } from "@/integrations/supabase/client";
import { downloadCsv, toCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Bell,
  Bot,
  Check,
  Download,
  Globe,
  Languages,
  Loader2,
  Package,
  Search,
  Send,
  Sparkles,
  Tag,
  X,
  ChevronLeft,
  Settings2,
} from "lucide-react";
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
  const [showTools, setShowTools] = useState(false);
  const [channel, setChannel] = useState<"chats" | "social">("chats");
  // Badge count of social DMs/comments still waiting for a reply.
  const socialPendingQuery = useQuery({
    queryKey: ["social_pending_count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("social_interactions")
        .select("id", { count: "exact", head: true })
        .eq("direction", "in")
        .eq("status", "open");
      return count ?? 0;
    },
    refetchInterval: 60_000,
  });
  const socialPending = socialPendingQuery.data ?? 0;
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "pending" | "closed">("all");
  const [tagDraft, setTagDraft] = useState("");
  const [reminderNote, setReminderNote] = useState("");
  const [reminderDue, setReminderDue] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [expandedTranslations, setExpandedTranslations] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);

  const send = useServerFn(sendAgentMessage);
  const suggest = useServerFn(draftBotReply);
  const sendTemplate = useServerFn(sendTemplateMessage);
  const auditEvent = useServerFn(recordAuditEvent);
  const translate = useServerFn(translateMessage);
  const buildCatalog = useServerFn(buildCatalogMessage);

  /** Fire-and-forget compliance log entry for an inbox action. */
  function logAction(
    action:
      | "conversation.assign"
      | "conversation.tag"
      | "conversation.status"
      | "reminder.create"
      | "conversations.export"
      | "transcript.export"
      | "message.translate",
    details: Record<string, unknown> = {},
  ) {
    void auditEvent({
      data: { action, entityType: "conversation", entityId: activeId ?? undefined, details },
    }).catch(() => {});
  }

  const team = useQuery({
    queryKey: ["team-basic"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, full_name, email");
      if (error) throw error;
      return data ?? [];
    },
  });

  const templates = useQuery({
    queryKey: ["approved-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wa_templates")
        .select("id, name, body, language")
        .eq("status", "approved")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const products = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, title, sku, price, description, images")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const conversations = useQuery({
    queryKey: ["conversations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("*, contacts(id, name, phone, company, stage), wa_numbers(label, display_phone)")
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

  // Near real-time inbox: realtime stream first, short polling as a fallback
  // whenever the socket is not connected, plus a visible connection indicator.
  const [liveStatus, setLiveStatus] = useState<"connecting" | "live" | "offline">("connecting");
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);

  useEffect(() => {
    const bump = () => setLastEventAt(Date.now());
    const channel = supabase
      .channel("inbox-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
        bump();
        void qc.invalidateQueries({ queryKey: ["messages"] });
        void qc.invalidateQueries({ queryKey: ["conversations"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => {
        bump();
        void qc.invalidateQueries({ queryKey: ["conversations"] });
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setLiveStatus("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED")
          setLiveStatus("offline");
        else setLiveStatus("connecting");
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);

  // Polling fallback — only runs while the realtime socket is not connected.
  useEffect(() => {
    if (liveStatus === "live") return;
    const timer = window.setInterval(() => {
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      void qc.invalidateQueries({ queryKey: ["messages"] });
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [liveStatus, qc]);

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

  // Auto-open the newest thread on desktop only. On mobile the list is a full
  // screen of its own, so auto-selecting would trap the user inside a chat.
  useEffect(() => {
    if (activeId || !list.length) return;
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(min-width: 1024px)").matches) return;
    setActiveId(list[0]!.id);
  }, [activeId, list]);

  useEffect(() => {
    if (!activeId) return;
    void supabase.from("conversations").update({ unread_count: 0 }).eq("id", activeId);
  }, [activeId]);

  const sendMutation = useMutation({
    mutationFn: async (body: string) => send({ data: { conversationId: activeId!, body } }),
    onSuccess: (res) => {
      if (res.blockedReasons?.length) {
        toast.error("Message blocked by safety rules", {
          description: res.blockedReasons.join(" "),
        });
        return;
      }
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
    tags?: string[];
  };

  async function updateConversation(patch: ConvPatch) {
    if (!activeId) return;
    const { error } = await supabase.from("conversations").update(patch).eq("id", activeId);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (patch.assigned_to !== undefined) {
      logAction("conversation.assign", { assignedTo: patch.assigned_to });
    }
    if (patch.status) logAction("conversation.status", { status: patch.status });
    if (patch.tags) logAction("conversation.tag", { tags: patch.tags });
    void qc.invalidateQueries({ queryKey: ["conversations"] });
  }

  const reminders = useQuery({
    queryKey: ["reminders", activeId],
    enabled: Boolean(activeId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reminders")
        .select("*")
        .eq("conversation_id", activeId!)
        .order("due_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const addReminder = useMutation({
    mutationFn: async () => {
      if (!activeId || !reminderDue) throw new Error("Pick a date and time first");
      const { error } = await supabase.from("reminders").insert({
        conversation_id: activeId,
        contact_id: active?.contact_id ?? null,
        assigned_to: active?.assigned_to ?? user?.id ?? null,
        created_by: user?.id ?? null,
        note: reminderNote || "Follow up",
        due_at: new Date(reminderDue).toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      logAction("reminder.create", { note: reminderNote || "Follow up", due: reminderDue });
      setReminderNote("");
      setReminderDue("");
      toast.success("Follow-up reminder set");
      void qc.invalidateQueries({ queryKey: ["reminders", activeId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const templateMutation = useMutation({
    mutationFn: async () =>
      sendTemplate({ data: { templateId, conversationId: activeId!, variables: [] } }),
    onSuccess: (res) => {
      if (res.blockedReasons?.length) {
        toast.error("Template blocked by safety rules", {
          description: res.blockedReasons.join(" "),
        });
        return;
      }
      setTemplateId("");
      toast.success("Template sent");
      void qc.invalidateQueries({ queryKey: ["messages", activeId] });
      void qc.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const translateMutation = useMutation({
    mutationFn: async (messageId: string) =>
      translate({ data: { messageId, targetLanguage: "English" } }),
    onSuccess: (res, messageId) => {
      setExpandedTranslations((prev) => new Set(prev).add(messageId));
      logAction("message.translate", {
        messageId,
        detectedLanguage: res.detectedLanguage,
      });
      void qc.invalidateQueries({ queryKey: ["messages", activeId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const catalogMutation = useMutation({
    mutationFn: async () => buildCatalog({ data: { productIds: selectedProductIds } }),
    onSuccess: (res) => {
      setDraft((d) => (d ? `${d}\n\n${res.body}` : res.body));
      setSelectedProductIds([]);
      toast.success("Catalog message inserted — press Send to deliver");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function toggleReminderDone(id: string, done: boolean) {
    const { error } = await supabase.from("reminders").update({ done }).eq("id", id);
    if (error) toast.error(error.message);
    else void qc.invalidateQueries({ queryKey: ["reminders", activeId] });
  }

  function addTag() {
    const tag = tagDraft.trim().toLowerCase();
    if (!tag || !active) return;
    const next = Array.from(new Set([...(active.tags ?? []), tag]));
    setTagDraft("");
    void updateConversation({ tags: next });
  }

  function removeTag(tag: string) {
    if (!active) return;
    void updateConversation({ tags: (active.tags ?? []).filter((t) => t !== tag) });
  }

  function exportConversations() {
    const rows = (conversations.data ?? []).map((c) => ({
      contact: c.contacts?.name ?? "",
      phone: c.contacts?.phone ?? "",
      company: c.contacts?.company ?? "",
      channel: c.channel,
      whatsapp_line: c.wa_numbers?.label ?? "",
      status: c.status,
      bot_enabled: c.bot_enabled ? "yes" : "no",
      tags: (c.tags ?? []).join("|"),
      unread: c.unread_count,
      last_message_at: c.last_message_at,
      last_message: c.last_message_preview ?? "",
    }));
    downloadCsv(
      `flas-conversations-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(rows as unknown as Record<string, unknown>[], [
        { key: "contact", label: "Contact" },
        { key: "phone", label: "WhatsApp number" },
        { key: "company", label: "Company" },
        { key: "channel", label: "Channel" },
        { key: "whatsapp_line", label: "Your WhatsApp line" },
        { key: "status", label: "Status" },
        { key: "bot_enabled", label: "Bot enabled" },
        { key: "tags", label: "Tags" },
        { key: "unread", label: "Unread" },
        { key: "last_message_at", label: "Last message at" },
        { key: "last_message", label: "Last message" },
      ]),
    );
    logAction("conversations.export", { rows: rows.length });
    toast.success("Conversations CSV downloaded");
  }

  function exportTranscript() {
    if (!active) return;
    const rows = (messages.data ?? []).map((m) => ({
      time: m.created_at,
      from: m.sender,
      direction: m.direction,
      message: m.body,
      status: m.status,
    }));
    downloadCsv(
      `flas-chat-${active.contacts?.name ?? "transcript"}-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(rows as unknown as Record<string, unknown>[], [
        { key: "time", label: "Time" },
        { key: "from", label: "From" },
        { key: "direction", label: "Direction" },
        { key: "message", label: "Message" },
        { key: "status", label: "Status" },
      ]),
    );
    logAction("transcript.export", { rows: rows.length });
    toast.success("Transcript CSV downloaded");
  }

  if (channel === "social") {
    return (
      <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-1 flex-col lg:h-[100dvh]">
        <div className="flex items-center gap-2 border-b bg-card px-4 py-3">
          <h1 className="text-lg font-bold">Inbox</h1>
          <ChannelSwitch channel={channel} onChange={setChannel} pending={socialPending} />
        </div>
        <SocialInbox />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-1 lg:h-[100dvh]">
      {/* Conversation list */}
      <div
        className={cn(
          "w-full shrink-0 flex-col border-r bg-card lg:flex lg:max-w-sm",
          active ? "hidden" : "flex",
        )}
      >
        <div className="space-y-3 border-b p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="text-lg font-bold">Inbox</h1>
              <ChannelSwitch channel={channel} onChange={setChannel} pending={socialPending} />
              <span
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                  liveStatus === "live"
                    ? "border-brand/30 bg-brand/10 text-brand"
                    : liveStatus === "connecting"
                      ? "border-border bg-muted text-muted-foreground"
                      : "border-destructive/30 bg-destructive/10 text-destructive",
                )}
                title={
                  liveStatus === "live"
                    ? lastEventAt
                      ? `Live · last update ${new Date(lastEventAt).toLocaleTimeString()}`
                      : "Live — new messages arrive instantly"
                    : "Reconnecting — checking for new messages every 10 seconds"
                }
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    liveStatus === "live"
                      ? "animate-pulse bg-brand"
                      : liveStatus === "connecting"
                        ? "bg-muted-foreground"
                        : "bg-destructive",
                  )}
                />
                {liveStatus === "live"
                  ? "Live"
                  : liveStatus === "connecting"
                    ? "Connecting"
                    : "Polling"}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={exportConversations}
              disabled={(conversations.data ?? []).length === 0}
              title="Download all conversations as CSV"
            >
              <Download className="size-4" /> CSV
            </Button>
          </div>
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
                {c.wa_numbers && (
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    {c.wa_numbers.label}
                    {c.wa_numbers.display_phone ? ` · ${c.wa_numbers.display_phone}` : ""}
                  </Badge>
                )}
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
      <div className={cn("min-w-0 flex-1 flex-col lg:flex", active ? "flex" : "hidden")}>
        {!active ? (
          <div className="grid flex-1 place-items-center text-sm text-muted-foreground">
            Select a conversation to start monitoring.
          </div>
        ) : (
          <>
            <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3 lg:px-5">
              <div className="flex min-w-0 items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="-ml-2 shrink-0 lg:hidden"
                  onClick={() => setActiveId(null)}
                  aria-label="Back to conversations"
                >
                  <ChevronLeft className="size-5" />
                </Button>
                <div className="min-w-0">
                  <h2 className="truncate font-semibold">{active.contacts?.name}</h2>
                  <p className="truncate text-xs text-muted-foreground">
                    {active.contacts?.phone ?? "Website visitor"}
                    {active.contacts?.company ? ` · ${active.contacts.company}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex flex-1 flex-wrap items-center justify-end gap-2 lg:gap-4">
                <Button
                  variant="outline"
                  size="sm"
                  className="lg:hidden"
                  onClick={() => setShowTools((v) => !v)}
                  aria-expanded={showTools}
                >
                  <Settings2 className="size-4" /> Tools
                </Button>
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
                  variant="outline"
                  size="sm"
                  onClick={exportTranscript}
                  disabled={(messages.data ?? []).length === 0}
                  title="Download this chat as CSV"
                >
                  <Download className="size-4" /> Transcript
                </Button>
                <select
                  className="h-9 rounded-md border bg-background px-2 text-xs"
                  value={active.assigned_to ?? ""}
                  onChange={(e) => void updateConversation({ assigned_to: e.target.value || null })}
                >
                  <option value="">Unassigned</option>
                  {(team.data ?? []).map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.id === user?.id
                        ? "Me"
                        : member.full_name || member.email || "Teammate"}
                    </option>
                  ))}
                </select>
              </div>
            </header>

            {/* Thread tools: tags, templates, follow-up reminders */}
            <div
              className={cn(
                "space-y-3 border-b bg-card px-4 py-3 lg:block lg:px-5",
                showTools ? "block" : "hidden",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Tag className="size-4 text-muted-foreground" />
                {(active.tags ?? []).map((tag) => (
                  <Badge key={tag} variant="secondary" className="gap-1">
                    {tag}
                    <button aria-label={`Remove ${tag}`} onClick={() => removeTag(tag)}>
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
                <Input
                  className="h-8 w-40"
                  placeholder="Add tag"
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="h-8 rounded-md border bg-background px-2 text-xs"
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                >
                  <option value="">Send approved template…</option>
                  {(templates.data ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!templateId || templateMutation.isPending}
                  onClick={() => templateMutation.mutate()}
                >
                  {templateMutation.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                  Send template
                </Button>
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Package className="size-4 text-muted-foreground" />
                  <Input
                    className="h-8 w-48"
                    placeholder="Search products"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={selectedProductIds.length === 0 || catalogMutation.isPending}
                    onClick={() => catalogMutation.mutate()}
                  >
                    {catalogMutation.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Send className="size-4" />
                    )}
                    Insert catalog message
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(products.data ?? [])
                    .filter(
                      (p) =>
                        !productSearch ||
                        p.title.toLowerCase().includes(productSearch.toLowerCase()) ||
                        (p.sku ?? "").toLowerCase().includes(productSearch.toLowerCase()),
                    )
                    .slice(0, 8)
                    .map((p) => {
                      const selected = selectedProductIds.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() =>
                            setSelectedProductIds((prev) =>
                              selected ? prev.filter((id) => id !== p.id) : [...prev, p.id],
                            )
                          }
                          className={cn(
                            "flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors",
                            selected
                              ? "border-brand bg-brand/10 text-brand"
                              : "bg-muted text-muted-foreground hover:bg-muted/80",
                          )}
                        >
                          <span
                            className={cn(
                              "grid size-4 place-items-center rounded-full border",
                              selected
                                ? "border-brand bg-brand text-brand-foreground"
                                : "border-current",
                            )}
                          >
                            {selected && <Check className="size-3" />}
                          </span>
                          {p.title}
                          {p.price != null && <span className="opacity-70">${p.price}</span>}
                        </button>
                      );
                    })}
                  {(products.data ?? []).length === 0 && (
                    <p className="text-xs text-muted-foreground">No products in catalog yet.</p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Bell className="size-4 text-muted-foreground" />
                <Input
                  className="h-8 w-56"
                  placeholder="Follow-up note"
                  value={reminderNote}
                  onChange={(e) => setReminderNote(e.target.value)}
                />
                <Input
                  type="datetime-local"
                  className="h-8 w-52"
                  value={reminderDue}
                  onChange={(e) => setReminderDue(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!reminderDue || addReminder.isPending}
                  onClick={() => addReminder.mutate()}
                >
                  Set reminder
                </Button>
              </div>

              {(reminders.data ?? []).length > 0 && (
                <ul className="space-y-1">
                  {(reminders.data ?? []).map((r) => (
                    <li
                      key={r.id}
                      className={cn(
                        "flex items-center justify-between gap-3 rounded-md border px-3 py-1.5 text-xs",
                        r.done && "opacity-60",
                      )}
                    >
                      <span className="truncate">
                        {r.note} · {new Date(r.due_at).toLocaleString()}
                        {!r.done && new Date(r.due_at) < new Date() ? " · overdue" : ""}
                      </span>
                      <button
                        className="flex items-center gap-1 font-medium text-brand"
                        onClick={() => void toggleReminderDone(r.id, !r.done)}
                      >
                        <Check className="size-3" /> {r.done ? "Reopen" : "Done"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="chat-canvas-bg min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
              {(messages.data ?? []).map((m) => {
                const showTranslation = expandedTranslations.has(m.id);
                const hasTranslation = Boolean(m.translated_body);
                return (
                  <div
                    key={m.id}
                    className={cn(
                      "flex",
                      m.direction === "outbound" ? "justify-end" : "justify-start",
                    )}
                  >
                    <div
                      className={cn(
                        "group relative max-w-[70%] rounded-2xl px-4 py-2 text-sm shadow-panel",
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
                      {showTranslation && m.translated_body && (
                        <div className="mt-2 rounded-lg border border-dashed border-current/20 bg-black/5 p-2 text-xs opacity-90 dark:bg-white/5">
                          <p className="mb-1 font-semibold opacity-70">
                            {m.detected_language
                              ? `Translated from ${m.detected_language}`
                              : "Translation"}
                          </p>
                          <p className="whitespace-pre-wrap break-words">{m.translated_body}</p>
                        </div>
                      )}
                      <div className="mt-1 flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedTranslations((prev) => {
                              const next = new Set(prev);
                              if (next.has(m.id)) next.delete(m.id);
                              else {
                                next.add(m.id);
                                if (!hasTranslation) translateMutation.mutate(m.id);
                              }
                              return next;
                            })
                          }
                          disabled={translateMutation.isPending && !hasTranslation}
                          className="flex items-center gap-1 text-[10px] opacity-60 transition-opacity hover:opacity-100 disabled:opacity-40"
                        >
                          <Languages className="size-3" />
                          {showTranslation
                            ? "Hide"
                            : hasTranslation
                              ? "Show translation"
                              : "Translate"}
                        </button>
                        <span className="text-[10px] opacity-60">
                          {new Date(m.created_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
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

/** Toggle between WhatsApp/website chats and social DMs & comments. */
function ChannelSwitch({
  channel,
  onChange,
  pending,
}: {
  channel: "chats" | "social";
  onChange: (c: "chats" | "social") => void;
  pending: number;
}) {
  return (
    <div className="flex shrink-0 rounded-full bg-muted p-0.5 text-xs font-medium">
      {(["chats", "social"] as const).map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={cn(
            "flex items-center gap-1 rounded-full px-3 py-1 capitalize transition-colors",
            channel === c ? "bg-background shadow-sm" : "text-muted-foreground",
          )}
        >
          {c}
          {c === "social" && pending > 0 ? (
            <span className="rounded-full bg-brand px-1.5 text-[10px] text-brand-foreground">
              {pending}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
