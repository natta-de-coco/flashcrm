import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ExternalLink, FileText, Globe, PenSquare, Sparkles, BarChart3, Search } from "lucide-react";
import { useState } from "react";
import { SearchConsoleDashboard } from "@/components/seo/SearchConsoleDashboard";

export const Route = createFileRoute("/_authenticated/seo-blog/")({
  head: () => ({
    meta: [{ title: "SEO Studio — Flas CRM" }, { name: "robots", content: "noindex" }],
  }),
  component: SeoBlogHub,
});

type ArticleRow = {
  id: string;
  title: string;
  status: "draft" | "review" | "scheduled" | "published";
  seo_score: number;
  primary_keyword: string | null;
  wp_post_url: string | null;
  updated_at: string;
};

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  review: "bg-secondary text-secondary-foreground",
  scheduled: "bg-brand-soft text-brand",
  published: "bg-brand text-brand-foreground",
};

/** Content hub: every drafted and published SEO article for this workspace. */
function SeoBlogHub() {
  const articles = useQuery({
    queryKey: ["seo_articles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("seo_articles")
        .select("id, title, status, seo_score, primary_keyword, wp_post_url, updated_at")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ArticleRow[];
    },
  });

  const rows = articles.data ?? [];
  const published = rows.filter((r) => r.status === "published").length;
  const avgScore = rows.length
    ? Math.round(rows.reduce((s, r) => s + (r.seo_score ?? 0), 0) / rows.length)
    : 0;

  const [tab, setTab] = useState<"articles" | "search_console">("articles");

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-6 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">SEO & Search Studio</h1>
          <p className="text-sm text-muted-foreground">
            Rank higher on Google, monitor Search Console organic clicks, and publish AI articles.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {tab === "articles" ? (
            <Button asChild>
              <Link to="/seo-blog/studio" search={{ article: undefined }}>
                <PenSquare className="size-4 mr-1.5" /> New article
              </Link>
            </Button>
          ) : (
            <Button variant="outline" asChild>
              <Link to="/connect">
                <ExternalLink className="size-4 mr-1.5" /> Domain settings
              </Link>
            </Button>
          )}
        </div>
      </header>

      {/* Studio Tab Switcher */}
      <div className="flex items-center gap-2 border-b pb-3">
        <Button
          size="sm"
          variant={tab === "articles" ? "default" : "ghost"}
          onClick={() => setTab("articles")}
          className="gap-2 text-xs"
        >
          <FileText className="size-3.5" />
          Articles & Content Hub
        </Button>
        <Button
          size="sm"
          variant={tab === "search_console" ? "default" : "ghost"}
          onClick={() => setTab("search_console")}
          className="gap-2 text-xs"
        >
          <Search className="size-3.5" />
          Search Console Studio
        </Button>
      </div>

      {tab === "search_console" ? (
        <SearchConsoleDashboard />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand">
              <FileText className="size-5" />
            </span>
            <div>
              <p className="text-2xl font-bold leading-none">{rows.length}</p>
              <p className="text-xs text-muted-foreground">Articles drafted</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand">
              <Globe className="size-5" />
            </span>
            <div>
              <p className="text-2xl font-bold leading-none">{published}</p>
              <p className="text-xs text-muted-foreground">Published to WordPress</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand">
              <Sparkles className="size-5" />
            </span>
            <div>
              <p className="text-2xl font-bold leading-none">{avgScore}</p>
              <p className="text-xs text-muted-foreground">Average SEO score</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Articles</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {articles.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!articles.isLoading && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No articles yet. Open the studio, drop in product photos and let Flas AI draft your
              first post.
            </p>
          )}
          {rows.map((a) => (
            <div
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{a.title}</p>
                <p className="text-xs text-muted-foreground">
                  {a.primary_keyword ?? "no keyword"} · score {a.seo_score} · updated{" "}
                  {new Date(a.updated_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge className={`${STATUS_STYLE[a.status]} capitalize`}>{a.status}</Badge>
                {a.wp_post_url && (
                  <Button size="sm" variant="ghost" asChild>
                    <a href={a.wp_post_url} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-3.5" /> Live
                    </a>
                  </Button>
                )}
                <Button size="sm" variant="outline" asChild>
                  <Link to="/seo-blog/studio" search={{ article: a.id }}>
                    Open
                  </Link>
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
        </>
      )}
    </main>
  );
}
