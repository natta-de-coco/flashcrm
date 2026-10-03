import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Button } from "@/components/ui/button";
import { useReveal } from "@/hooks/useReveal";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Check, ChevronDown, Minus } from "lucide-react";

const SITE = "https://flas.mobidigisol.com";
const TITLE = "Pricing — WhatsApp CRM from $20/month | Flas CRM";
const DESCRIPTION =
  "Flas CRM pricing: one month free, then $20/month for six months instead of $30, or $240 a year. Every feature on every plan — no per-seat pricing, no feature gates.";

/** Everything is on every plan; the only variable is how you pay. */
const INCLUDED = [
  "Shared WhatsApp inbox, unlimited teammates",
  "Multiple WhatsApp numbers per company",
  "Flas AI chatbot with human handoff",
  "Social inbox — Instagram, Facebook, YouTube, X",
  "Contacts and lead pipeline",
  "WordPress plugin, Shopify package, script tag",
  "Email and WhatsApp campaigns with consent tracking",
  "SEO studio, publishing to your own WordPress",
  "Quotations, invoices and credit notes as branded PDFs",
  "AI business advisor and KPI alerts",
  "Monitoring, webhooks and delivery alerts",
  "Roles, audit logs, 2FA and per-company isolation",
];

const FAQS = [
  {
    q: "Is the WhatsApp message cost included?",
    a: "No, and no vendor can include it. Meta charges per message directly, at rates that vary by country and by whether the template is marketing, utility or authentication. Your Flas subscription and your Meta message spend are two separate bills.",
  },
  {
    q: "Do you charge per user?",
    a: "No. The subscription covers the whole company, however many teammates you add. A five-person team and a fifty-person team pay the same.",
  },
  {
    q: "What happens after the free month?",
    a: "Nothing is charged automatically without you choosing a plan. If you do not continue, your workspace becomes read-only rather than being deleted, and you can export your contacts and conversations.",
  },
  {
    q: "Can I pay in cash or by bank transfer?",
    a: "Yes. Mobi Digital Solutions activates the workspace manually against a bank transfer or cash payment and records the date you have paid up to. Contact us and we will invoice you.",
  },
  {
    q: "Is there a setup fee?",
    a: "Not for the software. WhatsApp Cloud API setup, Meta business verification and template approval are a separate service if you want us to handle them — ask for a quotation and we will price it against what you actually need.",
  },
];

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SITE}/pricing` },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: `${SITE}/pricing` }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Product",
          name: "Flas CRM",
          description: DESCRIPTION,
          url: `${SITE}/pricing`,
          brand: { "@type": "Brand", name: "Flas CRM" },
          offers: {
            "@type": "AggregateOffer",
            priceCurrency: "USD",
            lowPrice: "20",
            highPrice: "30",
            offerCount: 2,
            offers: [
              {
                "@type": "Offer",
                name: "Monthly",
                price: "20",
                priceCurrency: "USD",
                description:
                  "$20 per month for the first six months, then $30 per month. One month free first.",
                url: `${SITE}/auth`,
                availability: "https://schema.org/InStock",
              },
              {
                "@type": "Offer",
                name: "Yearly",
                price: "240",
                priceCurrency: "USD",
                description: "$240 per year instead of $360. One month free first.",
                url: `${SITE}/auth`,
                availability: "https://schema.org/InStock",
              },
            ],
          },
        }),
      },
      {
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
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: SITE },
            { "@type": "ListItem", position: 2, name: "Pricing", item: `${SITE}/pricing` },
          ],
        }),
      },
    ],
  }),
  component: Pricing,
});

function Pricing() {
  useReveal();

  return (
    <MarketingShell>
      <main>
        <section className="relative isolate overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
            <div className="flas-drift absolute -start-32 -top-32 size-[26rem] rounded-full bg-brand/20 blur-3xl" />
            <div
              className="flas-drift absolute -end-24 top-0 size-[20rem] rounded-full bg-brand/12 blur-3xl"
              style={{ animationDelay: "-4s" }}
            />
          </div>

          <div className="mx-auto max-w-3xl px-6 py-20 text-center">
            <h1 data-reveal className="text-4xl font-bold tracking-tight sm:text-5xl">
              One price. Every feature. Everyone on your team.
            </h1>
            <p
              data-reveal
              style={{ ["--reveal-delay" as string]: "60ms" }}
              className="mx-auto mt-4 max-w-xl text-base text-muted-foreground"
            >
              No per-seat billing and no feature gates — the difference between plans is how you
              pay, not what you get. Start with a free month.
            </p>
          </div>
        </section>

        <section className="mx-auto -mt-6 max-w-4xl px-6 pb-20">
          <div className="grid gap-5 md:grid-cols-2">
            {/* Monthly */}
            <div
              data-reveal
              className="rounded-3xl border bg-card p-7 shadow-panel transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
            >
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                Monthly
              </h2>
              <p className="mt-4 flex items-baseline gap-2">
                <span className="text-4xl font-bold">$20</span>
                <span className="text-sm text-muted-foreground">/month</span>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                <span className="line-through">$30</span> for your first six months, then $30.
              </p>
              <Button asChild size="lg" className="mt-6 w-full">
                <Link to="/auth">Start free for one month</Link>
              </Button>
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Cancel any time · no card needed to start
              </p>
            </div>

            {/* Yearly — the recommended one, so it carries the visual weight */}
            <div
              data-reveal
              style={{ ["--reveal-delay" as string]: "60ms" }}
              className="relative rounded-3xl border-2 border-brand bg-card p-7 shadow-lg transition-all duration-300 hover:-translate-y-1"
            >
              <span className="absolute -top-3 start-7 rounded-full bg-brand px-3 py-1 text-[11px] font-bold text-brand-foreground">
                Save $120
              </span>
              <h2 className="text-sm font-semibold uppercase tracking-widest text-brand">Yearly</h2>
              <p className="mt-4 flex items-baseline gap-2">
                <span className="text-4xl font-bold">$240</span>
                <span className="text-sm text-muted-foreground">/year</span>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                <span className="line-through">$360</span> — works out at $20 a month, held for the
                full year.
              </p>
              <Button asChild size="lg" className="mt-6 w-full">
                <Link to="/auth">
                  Start free for one month <ArrowRight className="size-4" />
                </Link>
              </Button>
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Pay by card, bank transfer or cash
              </p>
            </div>
          </div>

          {/* What you get — one list, because it is the same on both plans */}
          <div
            data-reveal
            className="mt-6 rounded-3xl border bg-muted/30 p-7"
            style={{ ["--reveal-delay" as string]: "100ms" }}
          >
            <h2 className="text-lg font-bold">Included on both plans</h2>
            <ul className="mt-5 grid gap-2.5 sm:grid-cols-2">
              {INCLUDED.map((item) => (
                <li key={item} className="flex gap-2.5 text-sm">
                  <Check className="mt-0.5 size-4 shrink-0 text-brand" />
                  <span className="text-muted-foreground">{item}</span>
                </li>
              ))}
            </ul>

            <div className="mt-6 flex gap-2.5 rounded-xl border border-dashed p-4 text-sm">
              <Minus className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">Not included:</span> WhatsApp&apos;s
                own per-message fees. Meta bills those directly and they vary by country — see{" "}
                <Link
                  to="/blog/$slug"
                  params={{ slug: "whatsapp-business-app-vs-api" }}
                  className="text-brand underline underline-offset-2"
                >
                  our guide on what the API actually costs
                </Link>
                .
              </p>
            </div>
          </div>
        </section>

        <section className="border-y bg-muted/30 py-20">
          <div className="mx-auto max-w-3xl px-6">
            <h2 data-reveal className="text-center text-3xl font-bold">
              Pricing questions
            </h2>
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

        <section className="mx-auto max-w-3xl px-6 py-20 text-center">
          <h2 data-reveal className="text-3xl font-bold">
            Try it with your own number
          </h2>
          <p
            data-reveal
            style={{ ["--reveal-delay" as string]: "60ms" }}
            className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground"
          >
            A month is long enough to move a real team onto it. If you would rather we set it up —
            including the Meta approvals — ask for a quotation.
          </p>
          <div
            data-reveal
            style={{ ["--reveal-delay" as string]: "120ms" }}
            className="mt-7 flex flex-wrap justify-center gap-3"
          >
            <Button asChild size="lg" className="flas-sheen relative overflow-hidden">
              <Link to="/auth">Start free for one month</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/" hash="quote">
                Request a quotation
              </Link>
            </Button>
          </div>
        </section>
      </main>
    </MarketingShell>
  );
}
