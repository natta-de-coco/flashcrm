import { MarketingShell } from "@/components/marketing/MarketingShell";
import { POSTS_BY_DATE, findPost } from "@/content/blog";
import { useReveal } from "@/hooks/useReveal";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";

const SITE = "https://flas.mobidigisol.com";

export const Route = createFileRoute("/blog/$slug")({
  // Resolved during the route load so the <head> tags below are rendered on the
  // server. A crawler must receive the real title and description in the HTML,
  // not after a client render.
  loader: ({ params }) => {
    const post = findPost(params.slug);
    if (!post) throw notFound();
    return { post };
  },

  head: ({ loaderData }) => {
    const post = loaderData?.post;
    if (!post) return {};
    const url = `${SITE}/blog/${post.slug}`;
    return {
      meta: [
        { title: `${post.title} | Flas CRM` },
        { name: "description", content: post.excerpt },
        { name: "keywords", content: post.keywords.join(", ") },
        { property: "og:title", content: post.title },
        { property: "og:description", content: post.excerpt },
        { property: "og:type", content: "article" },
        { property: "og:url", content: url },
        { property: "article:published_time", content: post.published },
        { property: "article:modified_time", content: post.updated ?? post.published },
        { name: "twitter:card", content: "summary_large_image" },
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            headline: post.title,
            description: post.excerpt,
            url,
            mainEntityOfPage: { "@type": "WebPage", "@id": url },
            datePublished: post.published,
            dateModified: post.updated ?? post.published,
            keywords: post.keywords.join(", "),
            author: { "@type": "Organization", name: "Mobi Digital Solutions" },
            publisher: {
              "@type": "Organization",
              name: "Mobi Digital Solutions",
              url: "https://mobidigisol.com",
            },
          }),
        },
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Home", item: SITE },
              { "@type": "ListItem", position: 2, name: "Guides", item: `${SITE}/blog` },
              { "@type": "ListItem", position: 3, name: post.title, item: url },
            ],
          }),
        },
      ],
    };
  },

  component: Article,
  notFoundComponent: () => (
    <MarketingShell>
      <main className="mx-auto max-w-2xl px-6 py-24 text-center">
        <h1 className="text-3xl font-bold">We couldn&apos;t find that guide</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          It may have been renamed. All the current guides are listed below.
        </p>
        <Link
          to="/blog"
          className="mt-6 inline-flex h-10 items-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground"
        >
          Browse all guides
        </Link>
      </main>
    </MarketingShell>
  ),
});

function Article() {
  const { post } = Route.useLoaderData();
  useReveal();

  const related = POSTS_BY_DATE.filter((p) => p.slug !== post.slug).slice(0, 2);
  const date = new Date(post.published).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <MarketingShell>
      <main className="mx-auto max-w-3xl px-6 py-12">
        <Link
          to="/blog"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> All guides
        </Link>

        <header className="mt-8">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="rounded-full bg-brand-soft px-2.5 py-1 font-semibold text-brand">
              {post.category}
            </span>
            <span className="text-muted-foreground">
              {date} · {post.readingMinutes} min read
            </span>
          </div>
          <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            {post.title}
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">{post.excerpt}</p>
        </header>

        <hr className="my-10" />

        {/* The HTML comes from src/content/blog.ts -- authored in this
            repository and reviewed at commit time. It is never user input and
            never loaded from the database, which is what makes setting it
            directly acceptable here. Do not repoint this at tenant content. */}
        <div className="flas-prose" dangerouslySetInnerHTML={{ __html: post.html }} />

        <section className="mt-14 rounded-3xl border bg-muted/40 px-8 py-10 text-center">
          <h2 className="text-2xl font-bold">Run all of this from one inbox</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
            Flas CRM gives your team a shared WhatsApp inbox, template management, lead capture and
            invoicing in one workspace. One month free.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              to="/auth"
              className="inline-flex h-10 items-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Start free
            </Link>
            <Link
              to="/"
              hash="quote"
              className="inline-flex h-10 items-center rounded-md border px-5 text-sm font-medium transition-colors hover:bg-accent"
            >
              Talk to us
            </Link>
          </div>
        </section>

        {related.length > 0 && (
          <section className="mt-14">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Keep reading
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {related.map((p) => (
                <Link
                  key={p.slug}
                  to="/blog/$slug"
                  params={{ slug: p.slug }}
                  className="group rounded-2xl border bg-card p-5 transition-all duration-300 hover:-translate-y-1 hover:border-brand/40 hover:shadow-lg"
                >
                  <span className="text-xs font-semibold uppercase tracking-wide text-brand">
                    {p.category}
                  </span>
                  <h3 className="mt-2 text-base font-semibold leading-snug group-hover:text-brand">
                    {p.title}
                  </h3>
                  <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand">
                    Read{" "}
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
    </MarketingShell>
  );
}
