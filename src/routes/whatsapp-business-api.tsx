import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Button } from "@/components/ui/button";
import { useReveal } from "@/hooks/useReveal";
import { InboxPreview } from "@/components/marketing/InboxPreview";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  Check,
  ChevronDown,
  FileCheck2,
  Phone,
  ShieldCheck,
  Users,
} from "lucide-react";

const SITE = "https://flas.mobidigisol.com";
const TITLE = "WhatsApp Business API setup, approval & shared inbox | Flas CRM";
const DESCRIPTION =
  "Get your WhatsApp Business API number approved and running with a shared team inbox. Meta business verification, display name review, template approval and a working CRM — handled by Mobi Digital Solutions.";

const STEPS = [
  {
    icon: FileCheck2,
    title: "Verification, prepared properly",
    body: "Most rejections are mismatches — a trade licence name that differs from the Meta Business account, or a website with no visible address. We check your documents against each other before anything is submitted.",
  },
  {
    icon: Phone,
    title: "Your number, registered",
    body: "The number must be free of any existing WhatsApp account, and deleting one erases its history. We walk you through whether to migrate the number your customers know or start on a new one.",
  },
  {
    icon: ShieldCheck,
    title: "Display name and templates approved",
    body: "A display name that names your business, and a starter library of templates written so they pass the first time — order confirmation, dispatch, appointment, quotation, payment reminder.",
  },
  {
    icon: Users,
    title: "A working inbox on day one",
    body: "The API on its own is credentials, not software. Your team gets a shared inbox with assignment, statuses, an AI chatbot and invoicing already connected to the number.",
  },
];

const FAQS = [
  {
    q: "What is the WhatsApp Business API?",
    a: "It is a programming interface hosted by Meta that lets software send and receive WhatsApp messages on your business number. It has no interface of its own — without a system connected to it, it is an unusable phone number. That system is what determines your daily experience, which is why choosing the inbox matters more than obtaining the credentials.",
  },
  {
    q: "How is it different from the free WhatsApp Business app?",
    a: "The free app runs on one phone and realistically supports one person answering. The API supports your whole team answering in parallel, with assignment so two agents never reply to the same chat, automated replies, and history that survives a lost phone. Most small businesses should stay on the free app until the constraint is the team rather than the phone.",
  },
  {
    q: "Can I keep my existing WhatsApp number?",
    a: "Yes, but the number cannot be active on WhatsApp when it is registered, and deleting the existing account deletes its chat history. Many businesses migrate the known number and accept the history loss, because customer recognition is usually worth more than an archive. Starting on a new number and redirecting gradually is the alternative.",
  },
  {
    q: "How long does approval take?",
    a: "Business verification is typically a few days when the documents are consistent, and display name review is usually quicker. Template approval is separate and worth starting early, since you cannot message customers first until at least one template is approved.",
  },
  {
    q: "What does it cost to send messages?",
    a: "Meta charges per message for templates, at rates that vary considerably by country and by category — marketing is the most expensive, then utility, then authentication. Replies you send inside the 24-hour window after a customer messages you carry no extra template fee. Check Meta's current rate card for the countries you actually message.",
  },
  {
    q: "Do I need the green tick?",
    a: "No. The green checkmark is an Official Business Account, granted separately from verification and based largely on whether your brand is notable in the press. It cannot be bought, and most businesses operate for years without one and lose no customers.",
  },
];

export const Route = createFileRoute("/whatsapp-business-api")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      {
        name: "keywords",
        content:
          "whatsapp business api, whatsapp cloud api, whatsapp api setup, meta business verification, whatsapp shared inbox, whatsapp crm",
      },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SITE}/whatsapp-business-api` },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: `${SITE}/whatsapp-business-api` }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Service",
          name: "WhatsApp Business API setup and shared inbox",
          serviceType: "WhatsApp Business Platform onboarding",
          description: DESCRIPTION,
          url: `${SITE}/whatsapp-business-api`,
          provider: {
            "@type": "Organization",
            name: "Mobi Digital Solutions",
            url: "https://mobidigisol.com",
          },
          areaServed: ["AE", "SA", "OM", "QA", "KW", "BH", "IN", "PK"],
          offers: {
            "@type": "Offer",
            price: "20",
            priceCurrency: "USD",
            description: "Flas CRM from $20 per month after a free month. Setup quoted separately.",
            url: `${SITE}/pricing`,
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
            {
              "@type": "ListItem",
              position: 2,
              name: "WhatsApp Business API",
              item: `${SITE}/whatsapp-business-api`,
            },
          ],
        }),
      },
    ],
  }),
  component: WhatsAppApiPage,
});

function WhatsAppApiPage() {
  useReveal();

  return (
    <MarketingShell>
      <main>
        <section className="relative isolate overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
            <div className="flas-drift absolute -start-28 -top-28 size-[28rem] rounded-full bg-brand/22 blur-3xl" />
            <div
              className="flas-drift absolute -end-24 top-16 size-[22rem] rounded-full bg-brand/12 blur-3xl"
              style={{ animationDelay: "-4s" }}
            />
          </div>

          <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <p data-reveal className="text-xs font-semibold uppercase tracking-widest text-brand">
                WhatsApp Business Platform
              </p>
              <h1
                data-reveal
                style={{ ["--reveal-delay" as string]: "50ms" }}
                className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl"
              >
                Your WhatsApp number, approved — and an inbox behind it
              </h1>
              <p
                data-reveal
                style={{ ["--reveal-delay" as string]: "100ms" }}
                className="mt-5 text-base text-muted-foreground sm:text-lg"
              >
                The API is credentials, not software. We handle Meta business verification, number
                registration, display name review and your first templates — then connect it to a
                shared inbox your whole team can answer from.
              </p>
              <div
                data-reveal
                style={{ ["--reveal-delay" as string]: "150ms" }}
                className="mt-8 flex flex-wrap gap-3"
              >
                <Button asChild size="lg" className="flas-sheen relative overflow-hidden">
                  <Link to="/" hash="quote">
                    Get a setup quotation <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link to="/auth">Start the CRM free</Link>
                </Button>
              </div>
              <ul
                data-reveal
                style={{ ["--reveal-delay" as string]: "200ms" }}
                className="mt-7 grid gap-2 text-sm"
              >
                {[
                  "Multiple numbers per company, routed automatically",
                  "AI chatbot with handoff to a human",
                  "Templates written to pass review first time",
                ].map((t) => (
                  <li key={t} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-brand" />
                    <span className="text-muted-foreground">{t}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div data-reveal style={{ ["--reveal-delay" as string]: "260ms" }}>
              <InboxPreview />
            </div>
          </div>
        </section>

        <section className="border-y bg-muted/30 py-20">
          <div className="mx-auto max-w-6xl px-6">
            <h2 data-reveal className="text-center text-3xl font-bold">
              What getting approved actually involves
            </h2>
            <p
              data-reveal
              style={{ ["--reveal-delay" as string]: "50ms" }}
              className="mx-auto mt-3 max-w-2xl text-center text-sm text-muted-foreground"
            >
              Applications rarely fail on merit. They fail on avoidable mismatches — which is
              exactly what this stage is for.
            </p>

            <div className="mt-12 grid gap-4 sm:grid-cols-2">
              {STEPS.map((s, i) => (
                <div
                  key={s.title}
                  data-reveal
                  style={{ ["--reveal-delay" as string]: `${(i % 2) * 50}ms` }}
                  className="rounded-2xl border bg-card p-6 shadow-panel transition-all duration-300 hover:-translate-y-1 hover:border-brand/40 hover:shadow-lg"
                >
                  <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand">
                    <s.icon className="size-5" />
                  </span>
                  <h3 className="mt-4 text-base font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
                </div>
              ))}
            </div>

            <p data-reveal className="mt-10 text-center text-sm text-muted-foreground">
              Prefer to do it yourself? Our{" "}
              <Link
                to="/blog/$slug"
                params={{ slug: "whatsapp-business-api-approval-checklist" }}
                className="font-medium text-brand underline underline-offset-2"
              >
                full approval checklist
              </Link>{" "}
              is free and holds nothing back.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-6 py-20">
          <h2 data-reveal className="text-center text-3xl font-bold">
            WhatsApp Business API questions
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

          <div data-reveal className="mt-12 rounded-3xl border bg-muted/40 px-8 py-10 text-center">
            <h2 className="text-2xl font-bold">Tell us your situation</h2>
            <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
              How many numbers, how many agents, and whether you are migrating an existing number.
              We will tell you honestly whether you need the API yet.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button asChild size="lg">
                <Link to="/" hash="quote">
                  Request a quotation
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/pricing">See CRM pricing</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>
    </MarketingShell>
  );
}
