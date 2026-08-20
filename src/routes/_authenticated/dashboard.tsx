import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { STAGES, type Contact, type Conversation } from "@/lib/crm-types";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Bot, Inbox, MessageSquare, Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Flas CRM" },
      {
        name: "description",
        content: "Live overview of WhatsApp conversations, leads and chatbot activity.",
      },
      { property: "og:title", content: "Dashboard — Flas CRM" },
      {
        property: "og:description",
        content: "Live overview of WhatsApp conversations, leads and chatbot activity.",
      },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const data = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [convs, contacts, msgs] = await Promise.all([
        supabase
          .from("conversations")
          .select("*, contacts(id, name, phone, company, stage)")
          .order("last_message_at", { ascending: false })
          .limit(100),
        supabase.from("contacts").select("*").limit(500),
        supabase.from("messages").select("id, sender, created_at").limit(1000),
      ]);
      if (convs.error) throw convs.error;
      if (contacts.error) throw contacts.error;
      if (msgs.error) throw msgs.error;
      return {
        conversations: convs.data as unknown as Conversation[],
        contacts: contacts.data as unknown as Contact[],
        messages: msgs.data,
      };
    },
  });

  const conversations = data.data?.conversations ?? [];
  const contacts = data.data?.contacts ?? [];
  const messages = data.data?.messages ?? [];

  const open = conversations.filter((c) => c.status === "open").length;
  const unread = conversations.reduce((sum, c) => sum + c.unread_count, 0);
  const botReplies = messages.filter((m) => m.sender === "bot").length;
  const pipelineValue = contacts
    .filter((c) => c.stage !== "lost")
    .reduce((sum, c) => sum + Number(c.value ?? 0), 0);

  const stats = [
    { label: "Open conversations", value: open, icon: Inbox },
    { label: "Unread messages", value: unread, icon: MessageSquare },
    { label: "Contacts", value: contacts.length, icon: Users },
    { label: "Bot replies", value: botReplies, icon: Bot },
  ];

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Everything happening across WhatsApp, your website widget and your pipeline.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="flex items-center gap-4 pt-6">
              <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand">
                <s.icon className="size-5" />
              </span>
              <div>
                <p className="text-2xl font-bold leading-none">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Recent conversations</CardTitle>
            <Link to="/inbox" className="text-xs font-medium text-brand hover:underline">
              Open inbox
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {conversations.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No conversations yet. Connect WhatsApp in Settings or embed the website widget.
              </p>
            )}
            {conversations.slice(0, 8).map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{c.contacts?.name ?? "Unknown"}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.last_message_preview ?? "No messages"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="secondary" className="text-[10px] capitalize">
                    {c.channel === "web" ? "Website" : "WhatsApp"}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] capitalize">
                    {c.status}
                  </Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pipeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-2xl font-bold">
              {pipelineValue.toLocaleString(undefined, {
                style: "currency",
                currency: "USD",
                maximumFractionDigits: 0,
              })}
            </p>
            {STAGES.map((stage) => {
              const count = contacts.filter((c) => c.stage === stage.id).length;
              const pct = contacts.length ? Math.round((count / contacts.length) * 100) : 0;
              return (
                <div key={stage.id}>
                  <div className="flex justify-between text-xs">
                    <span className="font-medium">{stage.label}</span>
                    <span className="text-muted-foreground">{count}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-muted">
                    <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
