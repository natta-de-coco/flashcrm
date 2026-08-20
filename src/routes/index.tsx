import { Button } from "@/components/ui/button";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Bot, Globe, Inbox, MessageSquare, Users, Zap } from "lucide-react";
import { useEffect } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Flas CRM — WhatsApp Chat CRM & AI Chatbot" },
      {
        name: "description",
        content:
          "Monitor WhatsApp chats, run an AI chatbot on your website, and manage leads in one shared team inbox.",
      },
      { property: "og:title", content: "Flas CRM — WhatsApp Chat CRM & AI Chatbot" },
      {
        property: "og:description",
        content:
          "Monitor WhatsApp chats, run an AI chatbot on your website, and manage leads in one shared team inbox.",
      },
    ],
  }),
  component: Landing,
});

const FEATURES = [
  {
    icon: Inbox,
    title: "Shared live inbox",
    body: "Every WhatsApp and website conversation in one real-time thread view with assignment and statuses.",
  },
  {
    icon: Bot,
    title: "AI chatbot with handoff",
    body: "The assistant answers instantly using your business knowledge, then hands off to a human on keywords.",
  },
  {
    icon: Users,
    title: "Leads pipeline",
    body: "Contacts sync from chats automatically and move through New to Won with deal values.",
  },
  {
    icon: Globe,
    title: "Website chat widget",
    body: "One script tag puts the same chat on your website, routed into the same inbox.",
  },
  {
    icon: Zap,
    title: "WhatsApp Cloud API",
    body: "Connect Meta's official API with a webhook URL — no third-party middleman.",
  },
  {
    icon: MessageSquare,
    title: "Team roles",
    body: "Admins own connections and the chatbot; agents focus on replying to customers.",
  },
];

function Landing() {
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "/widget.js";
    script.async = true;
    document.body.appendChild(script);
    return () => {
      script.remove();
      document.querySelector(".flasw")?.remove();
    };
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="flex items-center gap-2 font-bold">
          <span className="grid size-8 place-items-center rounded-lg bg-brand text-brand-foreground">
            <MessageSquare className="size-4" />
          </span>
          Flas CRM
        </span>
        <Button asChild size="sm">
          <Link to="/auth">Open app</Link>
        </Button>
      </header>

      <main>
        <section className="mx-auto max-w-3xl px-6 py-16 text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold text-brand">
            WhatsApp Cloud API · AI chatbot · Team inbox
          </span>
          <h1 className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl">
            The WhatsApp CRM your whole team can run
          </h1>
          <p className="mt-4 text-base text-muted-foreground">
            Monitor every WhatsApp conversation, let AI reply in seconds, capture leads
            automatically, and answer website visitors from the same inbox.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link to="/auth">Get started free</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/auth">Sign in</Link>
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Try the chat bubble in the corner — it lands in the live inbox.
          </p>
        </section>

        <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-20 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <article key={f.title} className="rounded-2xl border bg-card p-5 shadow-panel">
              <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand">
                <f.icon className="size-5" />
              </span>
              <h2 className="mt-4 text-base font-semibold">{f.title}</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">{f.body}</p>
            </article>
          ))}
        </section>
      </main>

      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        Flas CRM · WhatsApp monitoring, AI chatbot and lead pipeline in one workspace.
      </footer>
    </div>
  );
}
