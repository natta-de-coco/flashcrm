import { Button } from "@/components/ui/button";
import { FlasWordmark } from "@/components/FlashLogoBadge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useReveal } from "@/hooks/useReveal";
import { InboxPreview } from "@/components/marketing/InboxPreview";
import { StickyCta } from "@/components/marketing/StickyCta";
import { HomepageChatWidget } from "@/components/marketing/HomepageChatWidget";
import { POSTS } from "@/content/blog";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  BarChart3,
  Bot,
  Building2,
  CheckCircle2,
  FileText,
  Globe,
  Inbox,
  Mail,
  MessageSquare,
  Phone,
  Receipt,
  Search,
  ShoppingBag,
  Sparkles,
  Users,
  Zap,
  ChevronDown,
} from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Flas CRM by Mobi Digital Solutions — WhatsApp CRM & AI Growth" },
      {
        name: "description",
        content:
          "Flas CRM by Mobi Digital Solutions: WhatsApp Cloud API inbox, AI chatbot, social DMs & comments, leads, SEO content, invoicing and a business advisor. One month free, then $20/month.",
      },
      {
        property: "og:title",
        content: "Flas CRM by Mobi Digital Solutions — WhatsApp CRM & AI Growth",
      },
      {
        property: "og:description",
        content:
          "Every WhatsApp chat, social message, lead, invoice and SEO post in one AI-powered workspace. Request a quotation from Mobi Digital Solutions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://flas.mobidigisol.com/" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "Flas CRM",
          url: "https://flas.mobidigisol.com",
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web",
          description:
            "WhatsApp CRM with shared team inbox, AI chatbot, social inbox, lead capture plugins, SEO publishing, invoicing and an AI business advisor.",
          publisher: {
            "@type": "Organization",
            name: "Mobi Digital Solutions",
            url: "https://mobidigisol.com",
          },
          offers: [
            {
              "@type": "Offer",
              price: "20",
              priceCurrency: "USD",
              description:
                "Launch offer: $20 per month for the first six months instead of $30, after a one month free trial.",
            },
            {
              "@type": "Offer",
              price: "240",
              priceCurrency: "USD",
              description: "Yearly plan: $240 per year instead of $360.",
            },
          ],
        }),
      },
      {
        // FAQPage is the highest-leverage structured data on a page like this:
        // it is what produces the expandable questions under a search result.
        // The answers below are identical to the ones rendered on the page --
        // Google treats a mismatch as a violation, not a shortcut.
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQS.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "Mobi Digital Solutions",
          url: "https://mobidigisol.com",
          email: "info@mobidigisol.com",
          description:
            "Digital growth systems for businesses: websites and e-commerce, WhatsApp and CRM automation, SEO and content, paid social and search, and custom software.",
          sameAs: ["https://flas.mobidigisol.com"],
          contactPoint: [
            {
              "@type": "ContactPoint",
              contactType: "sales",
              email: "info@mobidigisol.com",
              telephone: "+971 50 963 0506",
              availableLanguage: ["en", "ar"],
            },
          ],
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "Flas CRM",
          url: "https://flas.mobidigisol.com",
          publisher: { "@type": "Organization", name: "Mobi Digital Solutions" },
        }),
      },
    ],
  }),

  component: Landing,
});

const MODULES = [
  {
    icon: Inbox,
    title: "Shared WhatsApp inbox",
    body: "Every WhatsApp Cloud API conversation in a real-time thread view with assignment, tags, statuses and follow-up reminders. Multiple numbers per company.",
  },
  {
    icon: Bot,
    title: "AI chatbot with human handoff",
    body: "Flas AI answers instantly from your own business knowledge, then hands the chat to an agent on keywords or when a customer asks for a human.",
  },
  {
    icon: MessageSquare,
    title: "Social comments — in review",
    // See the note in features.tsx: the capability registry, not this file,
    // decides what may be claimed here. No connector implements DM or comment
    // sync yet, and Google Business Messages shut down on 31 July 2024.
    body: "Facebook and Instagram comment sync is built and pending Meta's app review. WhatsApp and website chat are what the shared inbox covers today.",
  },
  {
    icon: Users,
    title: "Contacts & lead pipeline",
    body: "Contacts sync from every chat automatically and move New → Won with deal values, consent records, CSV import/export and duplicate protection.",
  },
  {
    icon: Globe,
    title: "Website & store plugins",
    body: "A downloadable WordPress plugin and Shopify package add a side-popup chatbot that captures WhatsApp number and email before chatting.",
  },
  {
    icon: Mail,
    title: "Email & WhatsApp marketing",
    body: "Consent-checked campaigns, approved WhatsApp templates, routing rules per number, and deliverability alerts so you stay out of spam.",
  },
  {
    icon: Search,
    title: "SEO & content studio",
    body: "Write once and publish straight to your own WordPress site with SEO title, description, keywords and a featured image attached.",
  },
  {
    icon: BarChart3,
    title: "AI business advisor",
    body: "Flas reviews your social reach, traffic, products, city and niche, then gives a strategic review, KPI targets and alerts when you miss them.",
  },
  {
    icon: Receipt,
    title: "Invoices & quotations",
    body: "Branded PDF invoices, quotations and credit notes with tax handling, QR verification, payment tracking and balances.",
  },
  {
    icon: Zap,
    title: "Monitoring & webhooks",
    body: "Live delivery status, retries, Meta sync health and alerts the moment a webhook or number stops behaving.",
  },
  {
    icon: Building2,
    title: "Multi-company & roles",
    body: "Each company is fully isolated with row-level security, scoped API keys, audit logs, 2FA, and roles that decide what every teammate can reach.",
  },
  {
    icon: Sparkles,
    title: "Bring your own AI keys",
    body: "Use Flas AI out of the box, or connect your own OpenAI or Claude key — your data stays in your workspace.",
  },
];

const CONNECTIONS = [
  "WhatsApp Cloud API",
  "Instagram",
  "Facebook Pages",
  "Threads",
  "Google Business Profile",
  "YouTube",
  "TikTok",
  "LinkedIn",
  "X / Twitter",
  "Pinterest",
  "Meta Ads",
  "Google Ads",
  "LinkedIn Ads",
  "TikTok Ads",
  "Google Analytics 4",
  "Search Console",
  "WordPress",
  "Shopify",
  "WooCommerce",
];

const STEPS = [
  {
    title: "Connect",
    body: "Add your WhatsApp number and link your social, ads and analytics accounts from the Integrations hub — each one has a step-by-step guide.",
  },
  {
    title: "Capture",
    body: "Install the WordPress or Shopify plugin, or drop one script tag on any site. Visitors leave their WhatsApp number and email before chatting.",
  },
  {
    title: "Convert",
    body: "Your team replies from one inbox, Flas AI drafts campaigns and content, and the advisor tells you what to fix next.",
  },
];

/**
 * Written against real search phrasing rather than marketing copy: these are
 * the questions the guides get asked, and the ones that appear in Google's
 * "People also ask". Answers are deliberately direct -- a hedged answer wins
 * no rich result and helps nobody.
 *
 * Kept in sync with the FAQPage JSON-LD below. Google requires the answer text
 * on the page to match the structured data, so both read from this array.
 */
const FAQS = [
  {
    q: "Do I need the WhatsApp Business API to use Flas CRM?",
    a: "Yes — Flas connects through the official WhatsApp Cloud API, which is what allows a whole team to answer from one number and lets the chatbot reply automatically. If you are still on the free WhatsApp Business app, Mobi Digital Solutions handles the move for you, including Meta business verification and display name approval.",
  },
  {
    q: "Can I connect more than one WhatsApp number?",
    a: "Yes. A workspace can hold several numbers — for example sales and support, or one per branch. Incoming chats are routed to the number the customer messaged, and replies go out from that same number, so the customer never sees a different sender.",
  },
  {
    q: "How long does WhatsApp Business API approval take?",
    a: "Business verification usually takes a few days once your documents are consistent, and display name review is normally quicker. Most delays come from avoidable mismatches — a trade licence name that differs from the Meta Business account, or a website with no visible phone number and address.",
  },
  {
    q: "Will it work with my existing website?",
    a: "Yes. There is a downloadable WordPress plugin, a Shopify theme package, and a single script tag for any other site. The popup asks a visitor for their WhatsApp number and email before the chat starts, so you capture the lead even if they never send a message.",
  },
  {
    q: "How much does Flas CRM cost?",
    a: "One month free, then $20 per month for your first six months instead of $30, or $240 a year instead of $360. WhatsApp's own per-message fees are charged separately by Meta and vary by country.",
  },
  {
    q: "Is my data kept separate from other companies?",
    a: "Every company is a separate tenant enforced by database row-level security, so one workspace cannot read another's contacts, conversations or credentials. Stored credentials are further restricted at the column level, audit logs record administrative actions, and each teammate's role decides what they can reach.",
  },
  {
    q: "Can I use my own OpenAI or Claude key?",
    a: "Yes. Flas AI works out of the box, or you can add your own OpenAI or Anthropic key in the workspace and all AI requests run against your account instead.",
  },
];

const WHATSAPP = "https://wa.me/9710509630506";

function Landing() {
  useReveal();

  // The chat widget loads through <HomepageChatWidget />, only when the
  // platform owner has a website under Integrations for this domain. It was
  // once embedded here with no key, so every visitor's message was silently
  // rejected; a widget with no working site behind it now simply isn't shown.

  const latest = POSTS.slice(0, 3);

  return (
    <div className="min-h-screen bg-background">
      <HomepageChatWidget />
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="flex min-w-0 items-center gap-3">
            <FlasWordmark className="h-8 max-w-28 sm:h-9 sm:max-w-36" />
            <span className="hidden border-s border-border ps-3 text-[10px] font-medium leading-tight text-muted-foreground sm:block">
              CRM by
              <br />
              Mobi Digital Solutions
            </span>
          </span>
          <nav className="flex items-center gap-4">
            <Link
              to="/features"
              className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline"
            >
              Features
            </Link>
            <Link
              to="/pricing"
              className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline"
            >
              Pricing
            </Link>
            <Link
              to="/blog"
              className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline"
            >
              Guides
            </Link>
            <a
              href="#quote"
              className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline"
            >
              Get a quote
            </a>
            <Button asChild size="sm">
              <Link to="/auth">Open app</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main>
        {/* ── Hero ──────────────────────────────────────────────────────────
            The drifting orbs sit behind the text in their own layer and are
            aria-hidden: they are atmosphere, and a screen reader announcing
            them would be noise. */}
        <section className="relative isolate overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
            <div className="flas-drift absolute -start-24 -top-24 size-[28rem] rounded-full bg-brand/25 blur-3xl" />
            <div
              className="flas-drift absolute -end-20 top-10 size-[22rem] rounded-full bg-brand/15 blur-3xl"
              style={{ animationDelay: "-3s" }}
            />
            <div
              className="flas-drift absolute bottom-0 start-1/3 size-[18rem] rounded-full bg-brand-deep/10 blur-3xl"
              style={{ animationDelay: "-6s" }}
            />
          </div>

          <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 sm:py-24 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8">
            <div className="text-center lg:text-start">
              <span
                data-reveal
                className="inline-flex items-center gap-2 rounded-full border border-brand/25 bg-brand-soft px-3 py-1 text-xs font-semibold text-brand"
              >
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-70" />
                  <span className="relative inline-flex size-2 rounded-full bg-brand" />
                </span>
                WhatsApp Cloud API · Flas AI · Social inbox · Invoicing
              </span>

              <h1
                data-reveal
                style={{ ["--reveal-delay" as string]: "50ms" }}
                className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl"
              >
                The complete WhatsApp &amp;{" "}
                <span className="bg-gradient-to-r from-brand to-brand-deep bg-clip-text text-transparent">
                  AI growth CRM
                </span>{" "}
                for your business
              </h1>

              <p
                data-reveal
                style={{ ["--reveal-delay" as string]: "100ms" }}
                className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground sm:text-lg lg:mx-0"
              >
                Flas CRM brings every WhatsApp chat, social message, website lead, campaign, invoice
                and SEO post into one workspace — with Flas AI writing, replying and advising
                alongside your team. Built and supported by Mobi Digital Solutions.
              </p>

              <div
                data-reveal
                style={{ ["--reveal-delay" as string]: "150ms" }}
                className="mt-9 flex flex-wrap justify-center gap-3 lg:justify-start"
              >
                <Button asChild size="lg" className="flas-sheen relative overflow-hidden">
                  <Link to="/auth">
                    Start free for one month <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <a href="#quote">Request a quotation</a>
                </Button>
              </div>

              <p
                data-reveal
                style={{ ["--reveal-delay" as string]: "200ms" }}
                className="mt-5 text-sm"
              >
                <span className="text-muted-foreground line-through">$30/month</span>{" "}
                <span className="font-semibold text-brand">
                  $20/month for your first six months
                </span>{" "}
                <span className="text-muted-foreground">
                  · or $240 a year instead of $360 · one month free first
                </span>
              </p>
              <p
                data-reveal
                style={{ ["--reveal-delay" as string]: "250ms" }}
                className="mt-2 text-xs text-muted-foreground"
              >
                Cancel any time · no card needed to start.
              </p>
            </div>

            {/* The product itself, rather than a stock photograph of a laptop. */}
            <div data-reveal style={{ ["--reveal-delay" as string]: "300ms" }}>
              <InboxPreview />
            </div>
          </div>
        </section>

        {/* ── Connections marquee ───────────────────────────────────────────
            Nineteen static pills read as a wall. Moving them turns the same
            list into something the eye follows, and hovering stops it so a
            reader can actually check for their own platform. */}
        <section className="border-y bg-muted/30 py-6">
          <p className="mb-4 text-center text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Connects to the platforms you already use
          </p>
          <div
            className="flas-marquee group relative overflow-hidden"
            /* Fades both ends so items enter and leave rather than pop. */
            style={{
              maskImage: "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)",
              WebkitMaskImage:
                "linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)",
            }}
          >
            <div className="flas-marquee-track flex w-max gap-2.5">
              {[...CONNECTIONS, ...CONNECTIONS].map((c, i) => (
                <span
                  key={`${c}-${i}`}
                  aria-hidden={i >= CONNECTIONS.length}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border bg-card px-3.5 py-1.5 text-xs font-medium shadow-sm"
                >
                  <CheckCircle2 className="size-3.5 text-brand" />
                  {c}
                </span>
              ))}
            </div>
          </div>
          <p className="mx-auto mt-4 max-w-2xl px-6 text-center text-xs text-muted-foreground">
            Every connection uses the platform&apos;s official API and its own secure login — with a
            written setup guide inside the app, including what Meta, Google and TikTok require
            before they will approve access.
          </p>
        </section>

        {/* ── Modules ───────────────────────────────────────────────────── */}
        <section id="modules" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-20">
          <h2 data-reveal className="text-center text-3xl font-bold">
            Everything inside Flas CRM
          </h2>
          <p
            data-reveal
            style={{ ["--reveal-delay" as string]: "60ms" }}
            className="mx-auto mt-2 max-w-xl text-center text-sm text-muted-foreground"
          >
            Twelve modules covering the whole path from a first message to a paid invoice.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {MODULES.map((m, i) => (
              <article
                key={m.title}
                data-reveal
                /* Stagger resets each row so the delay never grows long enough
                   to feel like the page is loading slowly. */
                style={{ ["--reveal-delay" as string]: `${(i % 3) * 70}ms` }}
                className="group rounded-2xl border bg-card p-5 shadow-panel transition-all duration-300 hover:-translate-y-1 hover:border-brand/40 hover:shadow-lg"
              >
                <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand transition-transform duration-300 group-hover:scale-110">
                  <m.icon className="size-5" />
                </span>
                <h3 className="mt-4 text-base font-semibold">{m.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{m.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ── How it works ──────────────────────────────────────────────── */}
        <section className="border-y bg-muted/30 py-20">
          <div className="mx-auto max-w-6xl px-6">
            <h2 data-reveal className="text-center text-3xl font-bold">
              Live in three steps
            </h2>
            <div className="mt-10 grid gap-6 lg:grid-cols-3">
              {STEPS.map((s, i) => (
                <div
                  key={s.title}
                  data-reveal
                  style={{ ["--reveal-delay" as string]: `${i * 110}ms` }}
                  className="relative rounded-2xl border bg-card p-6"
                >
                  <span className="grid size-9 place-items-center rounded-full bg-brand text-sm font-bold text-brand-foreground">
                    {i + 1}
                  </span>
                  <h3 className="mt-4 text-base font-bold">{s.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
                  {i < STEPS.length - 1 && (
                    <ArrowRight
                      aria-hidden
                      className="absolute -end-3 top-1/2 hidden size-6 -translate-y-1/2 text-brand/40 lg:block"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Latest guides ─────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-6 py-20">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div data-reveal>
              <h2 className="text-3xl font-bold">Guides &amp; playbooks</h2>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                Practical writing on WhatsApp Business, lead capture and the approvals Meta actually
                asks for — written from doing it, not from a keyword list.
              </p>
            </div>
            <Button asChild variant="outline" data-reveal>
              <Link to="/blog">
                Read all guides <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {latest.map((p, i) => (
              <Link
                key={p.slug}
                to="/blog/$slug"
                params={{ slug: p.slug }}
                data-reveal
                style={{ ["--reveal-delay" as string]: `${i * 80}ms` }}
                className="group flex flex-col rounded-2xl border bg-card p-5 shadow-panel transition-all duration-300 hover:-translate-y-1 hover:border-brand/40 hover:shadow-lg"
              >
                <span className="text-xs font-semibold uppercase tracking-wide text-brand">
                  {p.category}
                </span>
                <h3 className="mt-2 text-base font-semibold leading-snug group-hover:text-brand">
                  {p.title}
                </h3>
                <p className="mt-2 line-clamp-3 flex-1 text-sm text-muted-foreground">
                  {p.excerpt}
                </p>
                <span className="mt-4 text-xs text-muted-foreground">
                  {p.readingMinutes} min read
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* ── FAQ ───────────────────────────────────────────────────────────
            Native <details> rather than a JS accordion: it is open-able before
            hydration, keyboard-operable for free, and search engines read the
            answer text whether or not it is expanded. */}
        <section className="border-y bg-muted/30 py-20">
          <div className="mx-auto max-w-3xl px-6">
            <h2 data-reveal className="text-center text-3xl font-bold">
              Questions people ask before signing up
            </h2>
            <p
              data-reveal
              style={{ ["--reveal-delay" as string]: "50ms" }}
              className="mt-2 text-center text-sm text-muted-foreground"
            >
              Still unsure?{" "}
              <a href="#quote" className="text-brand underline underline-offset-2">
                Ask us directly
              </a>{" "}
              — we reply the same working day.
            </p>

            <div className="mt-10 grid gap-3">
              {FAQS.map((f, i) => (
                <details
                  key={f.q}
                  data-reveal
                  style={{ ["--reveal-delay" as string]: `${Math.min(i, 5) * 40}ms` }}
                  className="group rounded-2xl border bg-card px-5 py-4 shadow-sm transition-colors hover:border-brand/40"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-start font-semibold [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <ChevronDown
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground transition-transform duration-300 group-open:rotate-180"
                    />
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── About + quote ─────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-6 pb-20">
          <div className="grid gap-8 lg:grid-cols-2">
            <div data-reveal>
              <span className="inline-flex items-center gap-2 rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold text-brand">
                <ShoppingBag className="size-3.5" /> About Mobi Digital Solutions
              </span>
              <h2 className="mt-4 text-2xl font-bold">
                We don&apos;t just sell software — we build your digital engine
              </h2>
              <p className="mt-3 text-sm text-muted-foreground">
                Mobi Digital Solutions builds and runs digital growth systems for businesses:
                websites and e-commerce stores, WhatsApp and CRM automation, SEO and content, paid
                social and search campaigns, and custom software like Flas CRM itself.
              </p>
              <ul className="mt-4 grid gap-2 text-sm">
                {[
                  "Website, WordPress and Shopify development",
                  "WhatsApp Cloud API setup, verification and template approval",
                  "SEO, content and social media management",
                  "Meta, Google and TikTok advertising",
                  "Custom CRM, portal and automation development",
                  "Onboarding, training and ongoing support for Flas CRM",
                ].map((s) => (
                  <li key={s} className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand" />
                    <span className="text-muted-foreground">{s}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button asChild variant="outline">
                  <a href={WHATSAPP} target="_blank" rel="noreferrer noopener">
                    <Phone className="size-4" /> Chat on WhatsApp
                  </a>
                </Button>
                <Button asChild variant="ghost">
                  <a href="mailto:info@mobidigisol.com">
                    <Mail className="size-4" /> info@mobidigisol.com
                  </a>
                </Button>
              </div>
            </div>

            <div data-reveal style={{ ["--reveal-delay" as string]: "100ms" }}>
              <QuoteForm />
            </div>
          </div>
        </section>
      </main>

      <StickyCta />

      <footer className="border-t py-8 text-center text-xs text-muted-foreground">
        <p className="font-medium text-foreground">
          Flas CRM — a product of Mobi Digital Solutions
        </p>
        <p className="mt-1">
          WhatsApp monitoring, AI chatbot, social inbox, leads, marketing, SEO and invoicing in one
          workspace · flas.mobidigisol.com
        </p>
        <p className="mt-3 flex flex-wrap items-center justify-center gap-3">
          <Link to="/features" className="underline">
            Features
          </Link>
          <Link to="/pricing" className="underline">
            Pricing
          </Link>
          <Link to="/whatsapp-business-api" className="underline">
            WhatsApp API
          </Link>
          <Link to="/blog" className="underline">
            Guides
          </Link>
          <Link to="/privacy" className="underline">
            Privacy Policy
          </Link>
          <Link to="/terms" className="underline">
            Terms of Service
          </Link>
          <a href="mailto:info@mobidigisol.com" className="underline">
            Contact
          </a>
        </p>
      </footer>
    </div>
  );
}

/**
 * Quotation request. It composes the enquiry and hands it to WhatsApp or email
 * so no message is ever lost to a silent form, and Mobi Digital Solutions gets
 * the full brief in one place.
 */
function QuoteForm() {
  const [f, setF] = useState({
    name: "",
    company: "",
    email: "",
    phone: "",
    interest: "Flas CRM subscription",
    message: "",
  });

  const summary = [
    `New enquiry from flas.mobidigisol.com`,
    `Name: ${f.name}`,
    `Company: ${f.company}`,
    `Email: ${f.email}`,
    `WhatsApp/Phone: ${f.phone}`,
    `Interested in: ${f.interest}`,
    `Details: ${f.message}`,
  ].join("\n");

  return (
    <div id="quote" className="scroll-mt-20 rounded-2xl border bg-card p-6 shadow-panel">
      <h2 className="flex items-center gap-2 text-xl font-bold">
        <FileText className="size-5 text-brand" /> Request a quotation
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Tell us what you need — Flas CRM setup, a website, WhatsApp API approval, SEO or a custom
        build. We reply the same working day.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="q-name">Your name</Label>
          <Input
            id="q-name"
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            placeholder="Basel Yacoub"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="q-company">Company</Label>
          <Input
            id="q-company"
            value={f.company}
            onChange={(e) => setF({ ...f, company: e.target.value })}
            placeholder="Your business name"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="q-email">Email</Label>
          <Input
            id="q-email"
            type="email"
            value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })}
            placeholder="you@company.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="q-phone">WhatsApp number</Label>
          <Input
            id="q-phone"
            value={f.phone}
            onChange={(e) => setF({ ...f, phone: e.target.value })}
            placeholder="+971 50 000 0000"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="q-interest">What do you need?</Label>
          <select
            id="q-interest"
            value={f.interest}
            onChange={(e) => setF({ ...f, interest: e.target.value })}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option>Flas CRM subscription</option>
            <option>Flas CRM + full setup &amp; training</option>
            <option>WhatsApp Cloud API setup &amp; approval</option>
            <option>Website / WordPress / Shopify</option>
            <option>SEO &amp; content marketing</option>
            <option>Meta / Google / TikTok ads</option>
            <option>Custom software or portal</option>
          </select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="q-msg">Details</Label>
          <Textarea
            id="q-msg"
            rows={4}
            value={f.message}
            onChange={(e) => setF({ ...f, message: e.target.value })}
            placeholder="Number of team members, how many WhatsApp numbers, which platforms you want connected…"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild>
          <a
            href={`${WHATSAPP}?text=${encodeURIComponent(summary)}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            <Phone className="size-4" /> Send on WhatsApp
          </a>
        </Button>
        <Button asChild variant="outline">
          <a
            href={`mailto:info@mobidigisol.com?subject=${encodeURIComponent(
              `Quotation request — ${f.interest}`,
            )}&body=${encodeURIComponent(summary)}`}
          >
            <Mail className="size-4" /> Send by email
          </a>
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Your details are only used to answer this enquiry.
      </p>
    </div>
  );
}
