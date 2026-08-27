import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { CONNECTORS } from "@/lib/connections-catalog";

import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CalendarClock, FileText, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/content")({
  head: () => ({
    meta: [
      { title: "Content & SEO — Flash CRM" },
      {
        name: "description",
        content:
          "Draft, schedule and publish content across platforms with SEO title, description and keyword metadata.",
      },
      { property: "og:title", content: "Content & SEO — Flash CRM" },
      {
        property: "og:description",
        content: "Multi-platform content scheduling with built-in SEO metadata.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ContentPage,
});

type Post = {
  id: string;
  title: string | null;
  body: string | null;
  platforms: string[];
  status: string;
  scheduled_at: string | null;
  seo_metadata: Record<string, unknown> | null;
  created_at: string;
};

/**
 * Publish targets are derived from the connections catalogue, so this list can
 * never drift from what the platform APIs actually allow. "Website" is the
 * Flash-hosted blog feed (no plugin needed); "WordPress" pushes the same post
 * into your own WordPress site through the Flash plugin.
 */
const PLATFORMS: { id: string; label: string; hint: string }[] = [
  {
    id: "website",
    label: "Website (Flash blog)",
    hint: "Published on your Flash-hosted blog feed and used as SEO content — no plugin required.",
  },
  ...CONNECTORS.filter((c) => c.capabilities.includes("publish")).map((c) => ({
    id: c.id === "wordpress" ? "wordpress" : c.id,
    label: c.id === "wordpress" ? "WordPress (your own site)" : c.name,
    hint: c.blurb,
  })),
];

const STATUS_STYLE: Record<string, string> = {
  draft: "secondary",
  scheduled: "outline",
  published: "default",
  failed: "destructive",
};

const emptyForm = {
  title: "",
  body: "",
  scheduled_at: "",
  seoTitle: "",
  seoDescription: "",
  seoKeywords: "",
};

function ContentPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [form, setForm] = useState(emptyForm);
  const [platforms, setPlatforms] = useState<string[]>(["website"]);

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ["content_posts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("content_posts")
        .select("id, title, body, platforms, status, scheduled_at, seo_metadata, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Post[];
    },
  });

  const savePost = useMutation({
    mutationFn: async (status: "draft" | "scheduled") => {
      const { error } = await supabase.from("content_posts").insert({
        title: form.title.trim() || null,
        body: form.body.trim() || null,
        platforms,
        status,
        author_id: user?.id ?? null,
        scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null,
        seo_metadata: {
          title: form.seoTitle.trim(),
          description: form.seoDescription.trim(),
          keywords: form.seoKeywords
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean),
        },
      });
      if (error) throw error;
    },
    onSuccess: (_data, status) => {
      setForm(emptyForm);
      void qc.invalidateQueries({ queryKey: ["content_posts"] });
      toast.success(status === "scheduled" ? "Post scheduled" : "Draft saved");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("content_posts").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["content_posts"] }),
    onError: (error: Error) => toast.error(error.message),
  });

  const removePost = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("content_posts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["content_posts"] });
      toast.success("Post deleted");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <main className="flex-1 space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">Content & SEO</h1>
        <p className="text-sm text-muted-foreground">
          Write once, schedule to multiple platforms, and keep SEO metadata attached to every post.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New post</CardTitle>
            <CardDescription>Save as a draft or schedule it for later.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="c-title">Title</Label>
              <Input
                id="c-title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="5 ways distributors cut lighting costs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-body">Body</Label>
              <Textarea
                id="c-body"
                rows={6}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                placeholder="Write your post…"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Publish to</Label>
              <div className="flex flex-wrap gap-1.5">
                {PLATFORMS.map((p) => {
                  const on = platforms.includes(p.id);
                  return (
                    <Button
                      key={p.id}
                      type="button"
                      size="sm"
                      title={p.hint}
                      variant={on ? "default" : "outline"}
                      onClick={() =>
                        setPlatforms(
                          on ? platforms.filter((x) => x !== p.id) : [...platforms, p.id],
                        )
                      }
                    >
                      {p.label}
                    </Button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Website is the Flash-hosted blog feed. WordPress pushes the same article into your
                own site through the Flash plugin. Social targets require the account to be linked in
                Integrations first.
              </p>
            </div>


            <div className="space-y-1.5">
              <Label htmlFor="c-when">Schedule for</Label>
              <Input
                id="c-when"
                type="datetime-local"
                value={form.scheduled_at}
                onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })}
              />
            </div>

            <div className="space-y-3 rounded-lg border p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                SEO metadata
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="c-seo-title">SEO title</Label>
                <Input
                  id="c-seo-title"
                  maxLength={60}
                  value={form.seoTitle}
                  onChange={(e) => setForm({ ...form, seoTitle: e.target.value })}
                  placeholder="Under 60 characters"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-seo-desc">Meta description</Label>
                <Textarea
                  id="c-seo-desc"
                  rows={2}
                  maxLength={160}
                  value={form.seoDescription}
                  onChange={(e) => setForm({ ...form, seoDescription: e.target.value })}
                  placeholder="Under 160 characters"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-seo-kw">Keywords</Label>
                <Input
                  id="c-seo-kw"
                  value={form.seoKeywords}
                  onChange={(e) => setForm({ ...form, seoKeywords: e.target.value })}
                  placeholder="comma, separated, keywords"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                disabled={savePost.isPending}
                onClick={() => savePost.mutate("draft")}
              >
                Save draft
              </Button>
              <Button
                className="flex-1 gap-2"
                disabled={savePost.isPending || !form.scheduled_at}
                onClick={() => savePost.mutate("scheduled")}
              >
                <CalendarClock className="size-4" />
                Schedule
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Posts</CardTitle>
            <CardDescription>{posts.length} post(s)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading && <p className="text-sm text-muted-foreground">Loading posts…</p>}
            {!isLoading && posts.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nothing here yet. Draft your first post on the left.
              </p>
            )}
            {posts.map((post) => (
              <div key={post.id} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <FileText className="size-4 text-muted-foreground" />
                  <p className="font-medium">{post.title ?? "Untitled post"}</p>
                  <Badge
                    variant={
                      (STATUS_STYLE[post.status] ?? "secondary") as
                        | "default"
                        | "secondary"
                        | "outline"
                        | "destructive"
                    }
                    className="capitalize"
                  >
                    {post.status}
                  </Badge>
                  {post.platforms.map((p) => (
                    <Badge key={p} variant="outline" className="capitalize">
                      {p}
                    </Badge>
                  ))}
                </div>
                {post.body && (
                  <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">{post.body}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {post.scheduled_at && (
                    <span className="text-xs text-muted-foreground">
                      {new Date(post.scheduled_at).toLocaleString()}
                    </span>
                  )}
                  {post.status !== "published" && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setStatus.mutate({ id: post.id, status: "published" })}
                    >
                      Mark published
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5"
                    onClick={() => removePost.mutate(post.id)}
                  >
                    <Trash2 className="size-3.5" />
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
