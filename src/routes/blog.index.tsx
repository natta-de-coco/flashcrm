import { MarketingShell } from "@/components/marketing/MarketingShell";
import { POSTS_BY_DATE } from "@/content/blog";
import { useReveal } from "@/hooks/useReveal";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

const SITE = "https://flas.mobidigisol.com";
const TITLE = "Guides & playbooks — WhatsApp Business, lead capture & approvals | Flas CRM";
const DESCRIPTION =
  "Practical guides to the WhatsApp Business Platform: choosing between the app and the API, passing Meta verification, getting templates approved and capturing leads that reply.";

export const Route = createFileRoute("/blog/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SITE}/blog` },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: `${SITE}/blog` }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Blog",
          name: "Flas CRM Guides",
          url: `${SITE}/blog`,
          description: DESCRIPTION,
          publisher: {
            "@type": "Organization",
            name: "Mobi Digital Solutions",
            url: "https://mobidigisol.com",
          },
          blogPost: POSTS_BY_DATE.map((p) => ({
            "@type": "BlogPosting",
            headline: p.title,
            description: p.excerpt,
            url: `${SITE}/blog/${p.slug}`,
            datePublished: p.published,
            dateModified: p.updated ?? p.published,
          })),
        }),
      },
    ],
  }),
  component: BlogIndex,
});

function BlogIndex() {
  useReveal();

  const [lead, ...rest] = POSTS_BY_DATE;

  return (
    <MarketingShell>
      <main className="mx-auto max-w-6xl px-6 py-16">
        <header className="max-w-2xl">
          <p data-reveal className="text-xs font-semibold uppercase tracking-widest text-brand">
            Guides &amp; playbooks
          </p>
          <h1
            data-reveal
            style={{ ["--reveal-delay" as string]: "70ms" }}
            className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl"
          >
            WhatsApp Business, without the guesswork
          </h1>
          <p
            data-reveal
            style={{ ["--reveal-delay" as string]: "140ms" }}
            className="mt-4 text-base text-muted-foreground"
          >
            Written from running these setups for real businesses — what Meta approves, what it
            rejects, and what actually turns a visitor into a conversation.
          </p>
        </header>

        {lead && (
          <Link
            to="/blog/$slug"
            params={{ slug: lead.slug }}
            data-reveal
            style={{ ["--reveal-delay" as string]: "200ms" }}
            className="group mt-12 block overflow-hidden rounded-3xl border bg-card shadow-panel transition-all duration-300 hover:-translate-y-1 hover:border-brand/40 hover:shadow-lg"
          >
            <div className="relative grid gap-6 p-8 sm:p-10">
              <div
                aria-hidden
                className="pointer-events-none absolute -end-16 -top-16 size-56 rounded-full bg-brand/15 blur-3xl"
              />
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="rounded-full bg-brand-soft px-2.5 py-1 font-semibold text-brand">
                  {lead.category}
                </span>
                <span className="text-muted-foreground">{lead.readingMinutes} min read</span>
              </div>
              <h2 className="max-w-3xl text-2xl font-bold leading-tight group-hover:text-brand sm:text-3xl">
                {lead.title}
              </h2>
              <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">{lead.excerpt}</p>
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand">
                Read the guide{" "}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </span>
            </div>
          </Link>
        )}

        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {rest.map((p, i) => (
            <Link
              key={p.slug}
              to="/blog/$slug"
              params={{ slug: p.slug }}
              data-reveal
              style={{ ["--reveal-delay" as string]: `${(i % 3) * 80}ms` }}
              className="group flex flex-col rounded-2xl border bg-card p-6 shadow-panel transition-all duration-300 hover:-translate-y-1 hover:border-brand/40 hover:shadow-lg"
            >
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <span className="rounded-full bg-brand-soft px-2.5 py-1 font-semibold text-brand">
                  {p.category}
                </span>
                <span className="text-muted-foreground">{p.readingMinutes} min</span>
              </div>
              <h2 className="mt-4 text-lg font-semibold leading-snug group-hover:text-brand">
                {p.title}
              </h2>
              <p className="mt-2 flex-1 text-sm text-muted-foreground">{p.excerpt}</p>
              <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-brand">
                Read{" "}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </span>
            </Link>
          ))}
        </div>

        <section
          data-reveal
          className="mt-16 rounded-3xl border bg-muted/40 px-8 py-10 text-center"
        >
          <h2 className="text-2xl font-bold">Want this set up for you?</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
            Mobi Digital Solutions handles WhatsApp Cloud API setup, business verification and
            template approval — then hands you a working inbox.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              to="/auth"
              className="inline-flex h-10 items-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Start free for one month
            </Link>
            <Link
              to="/"
              hash="quote"
              className="inline-flex h-10 items-center rounded-md border px-5 text-sm font-medium transition-colors hover:bg-accent"
            >
              Request a quotation
            </Link>
          </div>
        </section>
      </main>
    </MarketingShell>
  );
}
