import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ExternalLink, FileText, Globe, PenSquare, Sparkles } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";

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
  const { t, tr, tx } = useI18n();
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

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[1.75rem] font-bold leading-tight sm:text-3xl">
            {t("seoBlogIndex.seoStudio")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("seoBlogIndex.turnProductImagesIntoRanked")}
          </p>
        </div>
        <Button asChild>
          <Link to="/seo-blog/studio" search={{ article: undefined }}>
            <PenSquare className="size-4" /> {t("seoBlogIndex.newArticle")}
          </Link>
        </Button>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand">
              <FileText className="size-5" />
            </span>
            <div>
              <p className="stat-label">{t("seoBlogIndex.articlesDrafted")}</p>
              <p className="stat-figure mt-1.5 text-[1.75rem] font-bold">{rows.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand">
              <Globe className="size-5" />
            </span>
            <div>
              <p className="stat-label">{t("seoBlogIndex.publishedToWordpress")}</p>
              <p className="stat-figure mt-1.5 text-[1.75rem] font-bold">{published}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand">
              <Sparkles className="size-5" />
            </span>
            <div>
              <p className="stat-label">{t("seoBlogIndex.averageSeoScore")}</p>
              <p className="stat-figure mt-1.5 text-[1.75rem] font-bold">{avgScore}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">{t("seoBlogIndex.articles")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {articles.isLoading && (
            <p className="text-sm text-muted-foreground">{t("seoBlogIndex.loading")}</p>
          )}
          {!articles.isLoading && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t("seoBlogIndex.noArticlesYetOpenThe")}
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
                  {tr("seoBlogIndex.scoreUpdated", {
                    value: a.primary_keyword ?? t("seoBlogIndex.noKeyword"),
                    seoscore: a.seo_score,
                    toLocaleDateString: new Date(a.updated_at).toLocaleDateString(),
                  })}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge className={`${STATUS_STYLE[a.status]} capitalize`}>
                  {tx(`seoBlogIndex.status.${a.status}`, a.status)}
                </Badge>
                {a.wp_post_url && (
                  <Button size="sm" variant="ghost" asChild>
                    <a href={a.wp_post_url} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-3.5" /> {t("seoBlogIndex.live")}
                    </a>
                  </Button>
                )}
                <Button size="sm" variant="outline" asChild>
                  <Link to="/seo-blog/studio" search={{ article: a.id }}>
                    {t("seoBlogIndex.open")}
                  </Link>
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
