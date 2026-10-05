import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Button } from "@/components/ui/button";
import { useReveal } from "@/hooks/useReveal";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  BarChart3,
  Bot,
  Building2,
  Globe,
  Inbox,
  Mail,
  MessageSquare,
  Receipt,
  Search,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { useI18n } from "@/hooks/useI18n";

const SITE = "https://flas.mobidigisol.com";
const TITLE = "Features — shared WhatsApp inbox, AI chatbot, invoicing | Flas CRM";
const DESCRIPTION =
  "Everything inside Flas CRM: a shared WhatsApp inbox for your whole team, an AI chatbot with human handoff, social DMs, lead capture plugins, campaigns, SEO publishing, invoicing and per-company isolation.";

/**
 * Grouped rather than listed flat.
 *
 * Twelve equal cards tell a visitor what exists but not what it is for. These
 * four groups follow the path a customer actually takes — they arrive, you
 * talk to them, you sell to them, you run the business behind it — so someone
 * scanning the page can find their own problem instead of reading everything.
 */
const GROUPS = [
  {
    name: "Talk to customers",
    lede: "Every conversation your business has, in one place, answerable by anyone on the team.",
    items: [
      {
        icon: Inbox,
        title: "Shared WhatsApp inbox",
        body: "Real-time threads with assignment, tags, statuses and follow-up reminders, so two agents never answer the same chat and none goes cold. Several numbers per company, each replying as itself.",
      },
      {
        icon: Bot,
        title: "AI chatbot with human handoff",
        body: "Flas AI answers instantly from your own business knowledge — products, prices, hours — then hands over to an agent on keywords or the moment a customer asks for a person.",
      },
      {
        icon: MessageSquare,
        title: "Social comments, in progress",
        // Do not restore a claim here without checking the capability registry
        // in social-connector-definitions.ts first. The previous copy promised
        // an inbox for Instagram, Facebook, YouTube, X and Google Business
        // messages; the registry reports that no connector implements DM or
        // comment sync today, and Google shut Business Messages down on
        // 31 July 2024. The registry is the source of truth for this sentence.
        body: "Facebook and Instagram comment sync is built and waiting on Meta's app review, which each workspace completes with its own Business account. Until it clears, social replies still happen on the platform — WhatsApp and website chat are the two channels the shared inbox covers today.",
      },
    ],
  },
  {
    name: "Capture leads",
    lede: "Turn the people already visiting your website into conversations you can answer.",
    items: [
      {
        icon: Globe,
        title: "Website and store plugins",
        body: "A WordPress plugin, a Shopify theme package, or one script tag for anything else. The popup asks for a WhatsApp number and email before the chat opens, so you have the lead even if they never type.",
      },
      {
        icon: Users,
        title: "Contacts and pipeline",
        body: "Contacts sync from every chat automatically and move New through to Won, with deal values, consent records, CSV import and export, and duplicate protection.",
      },
      {
        icon: Mail,
        title: "Campaigns that stay compliant",
        body: "Consent-checked email and WhatsApp campaigns using approved templates, routing rules per number, and deliverability alerts — because blocks are what get a number restricted.",
      },
    ],
  },
  {
    name: "Sell and get paid",
    lede: "From a quotation in a chat to a paid invoice, without leaving the conversation.",
    items: [
      {
        icon: Receipt,
        title: "Quotations and invoices",
        body: "Branded PDF quotations, invoices and credit notes with tax handling, QR verification, payment tracking and running balances — sent straight into the WhatsApp thread.",
      },
      {
        icon: Search,
        title: "SEO and content studio",
        body: "Turn product photos into an article with SEO title, description, keywords and a featured image, then publish it directly to your own WordPress site.",
      },
      {
        icon: BarChart3,
        title: "AI business advisor",
        body: "Reviews your reach, traffic, products, city and niche, then gives a strategic read, KPI targets, and an alert when you drift off them.",
      },
    ],
  },
  {
    name: "Run it safely",
    lede: "The parts you only notice when they are missing.",
    items: [
      {
        icon: Building2,
        title: "Roles and per-company isolation",
        body: "Every company is a separate tenant enforced by row-level security. Roles decide what each teammate reaches — an SEO editor has no inbox, a staff agent has no billing.",
      },
      {
        icon: Zap,
        title: "Monitoring and webhooks",
        body: "Live delivery status, retries, Meta sync health, and an alert the moment a webhook or a number stops behaving — before your customers notice.",
      },
      {
        icon: Sparkles,
        title: "Bring your own AI keys",
        body: "Use Flas AI as it comes, or connect your own OpenAI or Claude key so every AI request runs against your account and your data stays in your workspace.",
      },
    ],
  },
];

export const Route = createFileRoute("/features")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SITE}/features` },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: `${SITE}/features` }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: "Flas CRM features",
          description: DESCRIPTION,
          itemListElement: GROUPS.flatMap((g) => g.items).map((item, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: item.title,
            description: item.body,
          })),
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: SITE },
            { "@type": "ListItem", position: 2, name: "Features", item: `${SITE}/features` },
          ],
        }),
      },
    ],
  }),
  component: Features,
});

function Features() {
  const { t } = useI18n();
  useReveal();

  return (
    <MarketingShell>
      <main>
        <section className="relative isolate overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
            <div className="flas-drift absolute -start-32 -top-32 size-[26rem] rounded-full bg-brand/20 blur-3xl" />
          </div>
          <div className="mx-auto max-w-3xl px-6 py-20 text-center">
            <h1 data-reveal className="text-4xl font-bold tracking-tight sm:text-5xl">
              {t("features.theWholePathFromFirst")}
            </h1>
            <p
              data-reveal
              style={{ ["--reveal-delay" as string]: "60ms" }}
              className="mx-auto mt-4 max-w-xl text-base text-muted-foreground"
            >
              {t("features.twelveModulesGroupedByThe")}
            </p>
          </div>
        </section>

        {GROUPS.map((group, gi) => (
          <section
            key={group.name}
            className={gi % 2 === 1 ? "border-y bg-muted/30 py-16" : "py-16"}
          >
            <div className="mx-auto max-w-6xl px-6">
              <div className="max-w-2xl">
                <h2 data-reveal className="text-2xl font-bold">
                  {group.name}
                </h2>
                <p
                  data-reveal
                  style={{ ["--reveal-delay" as string]: "40ms" }}
                  className="mt-2 text-sm text-muted-foreground"
                >
                  {group.lede}
                </p>
              </div>

              <div className="mt-8 grid gap-4 md:grid-cols-3">
                {group.items.map((item, i) => (
                  <article
                    key={item.title}
                    data-reveal
                    style={{ ["--reveal-delay" as string]: `${i * 45}ms` }}
                    className="group rounded-2xl border bg-card p-6 shadow-panel transition-all duration-300 hover:-translate-y-1 hover:border-brand/40 hover:shadow-lg"
                  >
                    <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand transition-transform duration-300 group-hover:scale-110">
                      <item.icon className="size-5" />
                    </span>
                    <h3 className="mt-4 text-base font-semibold">{item.title}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">{item.body}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>
        ))}

        <section className="mx-auto max-w-3xl px-6 py-20 text-center">
          <h2 data-reveal className="text-3xl font-bold">
            {t("features.seeItWithYourOwn")}
          </h2>
          <p
            data-reveal
            style={{ ["--reveal-delay" as string]: "60ms" }}
            className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground"
          >
            {t("features.oneMonthFreeNoCard")}
          </p>
          <div
            data-reveal
            style={{ ["--reveal-delay" as string]: "120ms" }}
            className="mt-7 flex flex-wrap justify-center gap-3"
          >
            <Button asChild size="lg" className="flas-sheen relative overflow-hidden">
              <Link to="/auth">
                {t("features.startFree")} <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/whatsapp-business-api">{t("features.getMyNumberApproved")}</Link>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <Link to="/pricing">{t("features.seePricing")}</Link>
            </Button>
          </div>
        </section>
      </main>
    </MarketingShell>
  );
}
