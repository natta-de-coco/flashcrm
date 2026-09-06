import { Button } from "@/components/ui/button";
import { FlasWordmark } from "@/components/FlashLogoBadge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
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
} from "lucide-react";
import { useEffect, useState } from "react";

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
    title: "Social inbox — DMs & comments",
    body: "Instagram, Facebook, YouTube, X and Google Business messages and comments land in the same inbox with AI-suggested replies.",
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
    body: "Write once and publish to your Flas blog, your WordPress site and social channels with SEO title, description and keywords attached.",
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
    body: "Each company is fully isolated with row-level security, scoped API keys, audit logs, 2FA and admin/agent roles.",
  },
  {
    icon: Sparkles,
    title: "Bring your own AI keys",
    body: "Use Flas AI out of the box, or connect your own OpenAI, Gemini or Claude key — your data stays in your workspace.",
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
    title: "1 · Connect",
    body: "Add your WhatsApp number and link your social, ads and analytics accounts from the Integrations hub — each one has a step-by-step guide.",
  },
  {
    title: "2 · Capture",
    body: "Install the WordPress or Shopify plugin, or drop one script tag on any site. Visitors leave their WhatsApp number and email before chatting.",
  },
  {
    title: "3 · Convert",
    body: "Your team replies from one inbox, Flas AI drafts campaigns and content, and the advisor tells you what to fix next.",
  },
];

const WHATSAPP = "https://wa.me/9710509630506";

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
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="flex min-w-0 items-center gap-3">
            <FlasWordmark className="h-8 max-w-28 sm:h-9 sm:max-w-36" />
            <span className="hidden border-l border-border pl-3 text-[10px] font-medium leading-tight text-muted-foreground sm:block">
              CRM by<br />Mobi Digital Solutions
            </span>
          </span>
          <nav className="flex items-center gap-2">
            <a
              href="#modules"
              className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline"
            >
              What's inside
            </a>
            <a
              href="#quote"
              className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline"
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
        <section className="mx-auto max-w-3xl px-6 py-16 text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold text-brand">
            WhatsApp Cloud API · Flas AI · Social inbox · Invoicing
          </span>
          <h1 className="mt-5 text-4xl font-bold tracking-tight sm:text-5xl">
            The complete WhatsApp &amp; AI growth CRM for your business
          </h1>
          <p className="mt-4 text-base text-muted-foreground">
            Flas CRM brings every WhatsApp chat, social message, website lead, campaign, invoice and
            SEO post into one workspace — with Flas AI writing, replying and advising alongside your
            team. Built and supported by Mobi Digital Solutions.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link to="/auth">Start free for one month</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="#quote">Request a quotation</a>
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            $20 per month per company after the free month · cancel any time · try the chat bubble in
            the corner, it lands in the live inbox.
          </p>
        </section>

        <section id="modules" className="mx-auto max-w-6xl px-6 pb-4">
          <h2 className="text-2xl font-bold">Everything inside Flas CRM</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Twelve working modules — not a demo. This is the full lead-to-revenue stack.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {MODULES.map((m) => (
              <article key={m.title} className="rounded-2xl border bg-card p-5 shadow-panel">
                <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand">
                  <m.icon className="size-5" />
                </span>
                <h3 className="mt-4 text-base font-semibold">{m.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{m.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="grid gap-6 lg:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.title} className="rounded-2xl border bg-card p-5">
                <h3 className="text-sm font-bold text-brand">{s.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-y bg-muted/40 py-14">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-2xl font-bold">Connects to the platforms you already use</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Every connection uses the platform's official API and its own secure login — with a
              written setup guide inside the app, including what Meta, Google and TikTok require
              before they will approve access.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {CONNECTIONS.map((c) => (
                <span
                  key={c}
                  className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium"
                >
                  <CheckCircle2 className="size-3.5 text-brand" />
                  {c}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="grid gap-8 lg:grid-cols-2">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold text-brand">
                <ShoppingBag className="size-3.5" /> About Mobi Digital Solutions
              </span>
              <h2 className="mt-4 text-2xl font-bold">
                We don't just sell software — we build your digital engine
              </h2>
              <p className="mt-3 text-sm text-muted-foreground">
                Mobi Digital Solutions builds and runs digital growth systems for businesses:
                websites and e-commerce stores, WhatsApp and CRM automation, SEO and content,
                paid social and search campaigns, and custom software like Flas CRM itself.
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

            <QuoteForm />
          </div>
        </section>
      </main>

      <footer className="border-t py-8 text-center text-xs text-muted-foreground">
        <p className="font-medium text-foreground">
          Flas CRM — a product of Mobi Digital Solutions
        </p>
        <p className="mt-1">
          WhatsApp monitoring, AI chatbot, social inbox, leads, marketing, SEO and invoicing in one
          workspace · flas.mobidigisol.com
        </p>
        <p className="mt-3 flex flex-wrap items-center justify-center gap-3">
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
    <div id="quote" className="rounded-2xl border bg-card p-6 shadow-panel">
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
            <option>Flas CRM + full setup & training</option>
            <option>WhatsApp Cloud API setup & approval</option>
            <option>Website / WordPress / Shopify</option>
            <option>SEO & content marketing</option>
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
