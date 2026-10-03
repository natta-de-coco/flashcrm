import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { WordPressSitesCard } from "@/components/WordPressSitesCard";
import DOMPurify from "isomorphic-dompurify";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { supabase } from "@/integrations/supabase/client";
import { buildArticleJsonLd, computeSeoAudit, slugify } from "@/lib/seo-analyze";
import {
  analyzeImagesFn,
  generateDraftFn,
  generateMicroPostsFn,
  humanizeFn,
  publishArticleFn,
} from "@/lib/seo.functions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  Check,
  ImagePlus,
  Loader2,
  Sparkles,
  Star,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/seo-blog/studio")({
  validateSearch: (search: Record<string, unknown>) => ({
    article: typeof search["article"] === "string" ? search["article"] : undefined,
  }),
  head: () => ({
    meta: [{ title: "SEO Studio — Flas CRM" }, { name: "robots", content: "noindex" }],
  }),
  component: SeoStudioPage,
});

type StudioImage = { id: string; dataUrl: string; alt: string; featured: boolean };

type Faq = { q: string; a: string };

/** Downscales an image file to a max 1024px JPEG data URL for AI analysis/upload. */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Unsupported image"));
      img.onload = () => {
        const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function SeoStudioPage() {
  const { article } = Route.useSearch();
  const { user } = useAuth();
  const { tenant } = useTenant();
  const qc = useQueryClient();

  const analyze = useServerFn(analyzeImagesFn);
  const genDraft = useServerFn(generateDraftFn);
  const genMicro = useServerFn(generateMicroPostsFn);
  const humanize = useServerFn(humanizeFn);
  const publish = useServerFn(publishArticleFn);

  // --- state ---------------------------------------------------------------
  const [articleId, setArticleId] = useState<string | null>(article ?? null);
  const [images, setImages] = useState<StudioImage[]>([]);
  const [vision, setVision] = useState<{
    objects: string[];
    brandColors: string[];
    ocrText: string[];
    productAttributes: string[];
    moodTags: string[];
    summary: string;
  } | null>(null);
  const [mode, setMode] = useState<"article" | "micro">("article");
  const [keyword, setKeyword] = useState("");
  const [industry, setIndustry] = useState("");
  const [intent, setIntent] = useState("informational");
  const [tone, setTone] = useState("human expert");
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [metaTitle, setMetaTitle] = useState("");
  const [metaDesc, setMetaDesc] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [contentHtml, setContentHtml] = useState("");
  const [secondary, setSecondary] = useState<string[]>([]);
  const [faq, setFaq] = useState<Faq[]>([]);
  const [microPosts, setMicroPosts] = useState<
    Array<{ platform: string; text: string; hashtags: string[] }>
  >([]);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [pubSite, setPubSite] = useState("");
  const [pubStatus, setPubStatus] = useState<"draft" | "pending" | "publish" | "future">("draft");
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  // --- data ------------------------------------------------------------------
  const sites = useQuery({
    queryKey: ["wordpress_sites"],
    queryFn: async () => {
      const { data, error } = await supabase.from("wordpress_sites").select("id, label, site_url");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Load an existing article when opened from the hub.
  useEffect(() => {
    if (!article) return;
    void (async () => {
      const { data, error } = await supabase
        .from("seo_articles")
        .select("*")
        .eq("id", article)
        .maybeSingle();
      if (error || !data) return;
      setArticleId(data.id);
      setTitle(data.title);
      setSlug(data.slug ?? "");
      setSlugTouched(true);
      setMetaTitle(data.meta_title ?? "");
      setMetaDesc(data.meta_description ?? "");
      setExcerpt(data.excerpt ?? "");
      setContentHtml(data.content_html ?? "");
      setKeyword(data.primary_keyword ?? "");
      setSecondary(data.secondary_keywords ?? []);
      setFaq(((data.schema_markup as { faq?: Faq[] } | null)?.faq ?? []) as Faq[]);
      if (data.wp_site_id) setPubSite(data.wp_site_id);
    })();
  }, [article]);

  const audit = useMemo(
    () =>
      computeSeoAudit({
        title,
        metaTitle,
        metaDescription: metaDesc,
        contentHtml,
        primaryKeyword: keyword,
        secondaryKeywords: secondary,
        imageAlts: images.map((i) => i.alt),
      }),
    [title, metaTitle, metaDesc, contentHtml, keyword, secondary, images],
  );

  const jsonLd = useMemo(
    () =>
      buildArticleJsonLd({
        title,
        metaDescription: metaDesc,
        slug,
        siteUrl: sites.data?.find((s) => s.id === pubSite)?.site_url,
        businessName: tenant?.name,
        faq,
      }),
    [title, metaDesc, slug, sites.data, pubSite, tenant?.name, faq],
  );

  // --- actions ---------------------------------------------------------------
  async function onFiles(list: FileList | null) {
    if (!list) return;
    const next = [...images];
    for (const file of Array.from(list).slice(0, 4 - images.length)) {
      try {
        const dataUrl = await fileToDataUrl(file);
        next.push({
          id: crypto.randomUUID(),
          dataUrl,
          alt: "",
          featured: next.length === 0,
        });
      } catch {
        toast.error(`${file.name} could not be read`);
      }
    }
    setImages(next);
  }

  const analyzeMutation = useMutation({
    mutationFn: () =>
      analyze({
        data: {
          images: images.map((i) => i.dataUrl),
          hint: `${tenant?.name ?? ""} ${industry}`.trim(),
        },
      }),
    onSuccess: (v) => {
      setVision(v);
      toast.success("Vision context extracted");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Analysis failed"),
  });

  const draftMutation = useMutation({
    mutationFn: async () => {
      const params = {
        primaryKeyword: keyword,
        industry,
        intent,
        tone,
        visionSummary: vision?.summary ?? "",
        secondaryKeywords: secondary,
      };
      if (mode === "micro") {
        const posts = await genMicro({ data: params });
        return { posts } as const;
      }
      const draft = await genDraft({ data: params });
      return { draft } as const;
    },
    onSuccess: (r) => {
      if ("posts" in r) {
        setMicroPosts(r.posts);
        toast.success("Micro-posts generated");
        return;
      }
      setTitle(r.draft.title);
      setMetaTitle(r.draft.metaTitle);
      setMetaDesc(r.draft.metaDescription);
      setSlug(r.draft.slug);
      setExcerpt(r.draft.excerpt);
      setContentHtml(r.draft.contentHtml);
      setSecondary(r.draft.secondaryKeywords);
      setFaq(r.draft.faq);
      toast.success("SEO draft generated — review it before publishing");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Drafting failed"),
  });

  const humanizeMutation = useMutation({
    mutationFn: () => humanize({ data: { contentHtml, tone } }),
    onSuccess: (r) => {
      setContentHtml(r.contentHtml);
      toast.success("Rewritten in a human tone");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Rewrite failed"),
  });

  const saveMutation = useMutation({
    mutationFn: async (): Promise<string> => {
      if (!tenant?.id) throw new Error("Workspace not loaded yet.");
      const row = {
        tenant_id: tenant.id,
        author_id: user?.id ?? null,
        title: title || "Untitled article",
        slug,
        meta_title: metaTitle,
        meta_description: metaDesc,
        excerpt,
        content_html: contentHtml,
        primary_keyword: keyword || null,
        secondary_keywords: secondary,
        seo_score: audit.score,
        schema_markup: { jsonLd, faq } as never,
      };
      if (articleId) {
        const { error } = await supabase.from("seo_articles").update(row).eq("id", articleId);
        if (error) throw error;
        return articleId;
      }
      const { data, error } = await supabase.from("seo_articles").insert(row).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (id) => {
      setArticleId(id);
      qc.invalidateQueries({ queryKey: ["seo_articles"] });
      toast.success("Article saved");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      const id = articleId ?? (await saveMutation.mutateAsync());
      const featured = images.find((i) => i.featured)?.dataUrl;
      return publish({
        data: {
          articleId: id,
          siteId: pubSite,
          status: pubStatus,
          featuredImageDataUrl: featured,
        },
      });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["seo_articles"] });
      toast.success("Published to WordPress", {
        description: r.url || undefined,
        action: r.url ? { label: "Open", onClick: () => window.open(r.url, "_blank") } : undefined,
      });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Publish failed"),
  });

  function insertTag(open: string, close: string) {
    const el = editorRef.current;
    if (!el) return;
    const { selectionStart, selectionEnd, value } = el;
    const selected = value.slice(selectionStart, selectionEnd) || "text";
    const next = `${value.slice(0, selectionStart)}${open}${selected}${close}${value.slice(selectionEnd)}`;
    setContentHtml(next);
  }

  const generating = draftMutation.isPending;

  // --- render ------------------------------------------------------------------
  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/seo-blog"
            className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
          >
            <ArrowLeft className="size-3.5" /> SEO Studio
          </Link>
          <h1 className="text-lg font-bold">{articleId ? "Edit article" : "New article"}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={pubSite} onValueChange={setPubSite}>
            <SelectTrigger className="h-8 w-44 text-xs">
              <SelectValue placeholder="WordPress site" />
            </SelectTrigger>
            <SelectContent>
              {(sites.data ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={pubStatus} onValueChange={(v) => setPubStatus(v as typeof pubStatus)}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Save as draft</SelectItem>
              <SelectItem value="pending">Pending review</SelectItem>
              <SelectItem value="publish">Publish now</SelectItem>
              <SelectItem value="future">Schedule</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            disabled={saveMutation.isPending || !title}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? "Saving…" : "Save"}
          </Button>
          <Button
            size="sm"
            disabled={!pubSite || !contentHtml || publishMutation.isPending}
            title={
              !pubSite
                ? "Choose a WordPress site first"
                : !contentHtml
                  ? "Write or generate the article first"
                  : undefined
            }
            onClick={() => publishMutation.mutate()}
          >
            {publishMutation.isPending ? "Publishing…" : "Sync & publish"}
          </Button>
        </div>
      </div>

      {/* Publishing needs a connected WordPress site, and nothing said so: the
          site list was empty, "Sync & publish" stayed disabled, and the only
          screen that could add a site (WordPressSitesCard) was no longer shown
          on any page after the Integrations redesign. Offer it right here. */}
      {sites.isSuccess && (sites.data ?? []).length === 0 && (
        <div className="grid gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          <p>
            <span className="font-semibold">Connect a WordPress site to publish.</span> Articles
            from this studio are published to your WordPress website. You can write, generate and
            save drafts now; <span className="font-medium">Sync &amp; publish</span> turns on once a
            site is connected below.
          </p>
          <WordPressSitesCard />
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)_300px]">
        {/* Left: vision intake */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Image & vision intake</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <label
                className="grid cursor-pointer place-items-center gap-2 rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground hover:border-brand"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void onFiles(e.dataTransfer.files);
                }}
              >
                <ImagePlus className="size-6" />
                Drop PNG/JPG/WebP or click to browse (max 4)
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  className="hidden"
                  onChange={(e) => void onFiles(e.target.files)}
                />
              </label>

              {images.map((img) => (
                <div key={img.id} className="space-y-1.5 rounded-lg border p-2">
                  <div className="relative">
                    <img
                      src={img.dataUrl}
                      alt={img.alt || "uploaded"}
                      className="h-24 w-full rounded object-cover"
                    />
                    <button
                      type="button"
                      className="absolute end-1 top-1 rounded-full bg-background/80 p-1"
                      onClick={() => setImages(images.filter((i) => i.id !== img.id))}
                      aria-label="Remove image"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  <Input
                    className="h-7 text-xs"
                    placeholder="Alt text (SEO)"
                    value={img.alt}
                    onChange={(e) =>
                      setImages(
                        images.map((i) => (i.id === img.id ? { ...i, alt: e.target.value } : i)),
                      )
                    }
                  />
                  <button
                    type="button"
                    className={`flex items-center gap-1 text-[11px] ${img.featured ? "font-semibold text-brand" : "text-muted-foreground"}`}
                    onClick={() =>
                      setImages(images.map((i) => ({ ...i, featured: i.id === img.id })))
                    }
                  >
                    <Star className="size-3" />{" "}
                    {img.featured ? "Featured image" : "Set as featured"}
                  </button>
                </div>
              ))}

              <Button
                className="w-full"
                variant="outline"
                disabled={images.length === 0 || analyzeMutation.isPending}
                onClick={() => analyzeMutation.mutate()}
              >
                {analyzeMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                Analyze vision context
              </Button>
            </CardContent>
          </Card>

          {vision && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Vision extraction</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <p className="text-muted-foreground">{vision.summary}</p>
                {vision.brandColors.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {vision.brandColors.map((c) => (
                      <span
                        key={c}
                        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5"
                      >
                        <span
                          className="size-3 rounded-full border"
                          style={{ backgroundColor: c }}
                        />
                        {c}
                      </span>
                    ))}
                  </div>
                )}
                {(
                  [
                    ["Objects", vision.objects],
                    ["OCR text", vision.ocrText],
                    ["Attributes", vision.productAttributes],
                    ["Mood", vision.moodTags],
                  ] as const
                ).map(([label, items]) =>
                  items.length > 0 ? (
                    <div key={label}>
                      <p className="mb-1 font-semibold">{label}</p>
                      <div className="flex flex-wrap gap-1">
                        {items.map((o) => (
                          <Badge key={o} variant="secondary" className="text-[10px]">
                            {o}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ) : null,
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Center: parameters + editor */}
        <div className="space-y-4">
          <Card>
            <CardContent className="grid gap-2 pt-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="grid gap-1">
                <Label className="text-xs">Primary keyword</Label>
                <Input
                  className="h-8 text-xs"
                  placeholder="whatsapp crm for agencies"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">Industry / niche</Label>
                <Input
                  className="h-8 text-xs"
                  placeholder="SaaS, real estate…"
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">Search intent</Label>
                <Select value={intent} onValueChange={setIntent}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="informational">Informational</SelectItem>
                    <SelectItem value="commercial">Commercial</SelectItem>
                    <SelectItem value="transactional">Transactional</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">Tone of voice</Label>
                <Select value={tone} onValueChange={setTone}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="human expert">Human expert</SelectItem>
                    <SelectItem value="direct response">Direct response</SelectItem>
                    <SelectItem value="storytelling">Storytelling</SelectItem>
                    <SelectItem value="friendly guide">Friendly guide</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
                <div className="flex rounded-lg border p-0.5 text-xs">
                  <button
                    type="button"
                    className={`rounded-md px-3 py-1 ${mode === "article" ? "bg-brand text-brand-foreground" : ""}`}
                    onClick={() => setMode("article")}
                  >
                    Long-form article
                  </button>
                  <button
                    type="button"
                    className={`rounded-md px-3 py-1 ${mode === "micro" ? "bg-brand text-brand-foreground" : ""}`}
                    onClick={() => setMode("micro")}
                  >
                    Micro-posts
                  </button>
                </div>
                <Button
                  className="flex-1"
                  disabled={keyword.trim().length < 2 || generating}
                  onClick={() => draftMutation.mutate()}
                >
                  {generating ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Wand2 className="size-4" />
                  )}
                  {mode === "article" ? "Generate full SEO draft" : "Generate micro-posts"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {mode === "micro" && microPosts.length > 0 && (
            <div className="grid gap-3 lg:grid-cols-3">
              {microPosts.map((p) => (
                <Card key={p.platform}>
                  <CardHeader className="flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-sm">{p.platform}</CardTitle>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => {
                        void navigator.clipboard.writeText(
                          `${p.text}\n\n${p.hashtags.map((h) => `#${h}`).join(" ")}`,
                        );
                        toast.success("Copied");
                      }}
                    >
                      Copy
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <p className="whitespace-pre-wrap text-xs">{p.text}</p>
                    <p className="mt-2 text-xs text-brand">
                      {p.hashtags.map((h) => `#${h}`).join(" ")}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {mode === "article" && (
            <Card>
              <CardContent className="space-y-3 pt-4">
                <Input
                  placeholder="Article title (H1)"
                  className="text-lg font-bold"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    if (!slugTouched) setSlug(slugify(e.target.value));
                  }}
                />

                <div className="flex flex-wrap items-center gap-1 border-b pb-2 text-xs">
                  {(
                    [
                      ["H2", "<h2>", "</h2>"],
                      ["H3", "<h3>", "</h3>"],
                      ["Bold", "<strong>", "</strong>"],
                      ["Quote", "<blockquote>", "</blockquote>"],
                      ["List", "<ul><li>", "</li></ul>"],
                      ["Paragraph", "<p>", "</p>"],
                    ] as const
                  ).map(([label, open, close]) => (
                    <Button
                      key={label}
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => insertTag(open, close)}
                    >
                      {label}
                    </Button>
                  ))}
                  <span className="mx-2 h-4 w-px bg-border" />
                  <button
                    type="button"
                    className={`rounded px-2 py-1 ${tab === "write" ? "bg-secondary font-semibold" : ""}`}
                    onClick={() => setTab("write")}
                  >
                    Write
                  </button>
                  <button
                    type="button"
                    className={`rounded px-2 py-1 ${tab === "preview" ? "bg-secondary font-semibold" : ""}`}
                    onClick={() => setTab("preview")}
                  >
                    Preview
                  </button>
                </div>

                {tab === "write" ? (
                  <Textarea
                    ref={editorRef}
                    className="min-h-96 font-mono text-xs"
                    placeholder="Generate a draft or write HTML here…"
                    value={contentHtml}
                    onChange={(e) => setContentHtml(e.target.value)}
                  />
                ) : (
                  <div
                    className="prose prose-sm max-w-none rounded-lg border p-4"
                    // AI-generated HTML — sanitize before rendering. This is
                    // the only place stored blog content reaches the DOM
                    // un-escaped, and it's tenant-shared, so an unsanitized
                    // AI response (or a compromised one) was a stored XSS
                    // hitting every admin who opened the post.
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(contentHtml) }}
                  />
                )}

                <div className="grid gap-2 rounded-lg border p-3">
                  <p className="text-xs font-semibold">SEO metadata</p>
                  <div className="grid gap-1">
                    <Label className="flex justify-between text-xs">
                      Meta title
                      <span
                        className={
                          metaTitle.length >= 50 && metaTitle.length <= 60
                            ? "text-brand"
                            : "text-muted-foreground"
                        }
                      >
                        {metaTitle.length}/60
                      </span>
                    </Label>
                    <Input
                      className="h-8 text-xs"
                      value={metaTitle}
                      onChange={(e) => setMetaTitle(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label className="flex justify-between text-xs">
                      Meta description
                      <span
                        className={
                          metaDesc.length >= 140 && metaDesc.length <= 155
                            ? "text-brand"
                            : "text-muted-foreground"
                        }
                      >
                        {metaDesc.length}/155
                      </span>
                    </Label>
                    <Textarea
                      className="min-h-16 text-xs"
                      value={metaDesc}
                      onChange={(e) => setMetaDesc(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-xs">URL slug</Label>
                    <Input
                      className="h-8 text-xs"
                      value={slug}
                      onChange={(e) => {
                        setSlugTouched(true);
                        setSlug(slugify(e.target.value));
                      }}
                    />
                  </div>
                  <div className="rounded-lg bg-secondary/60 p-3 text-xs">
                    <p className="text-[11px] text-muted-foreground">Google preview</p>
                    <p className="truncate text-sm text-brand">
                      {metaTitle || title || "Your meta title"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      example.com/{slug || "your-slug"}
                    </p>
                    <p className="line-clamp-2">{metaDesc || "Your meta description…"}</p>
                  </div>
                  <details className="text-xs">
                    <summary className="cursor-pointer font-semibold">
                      JSON-LD structured data
                    </summary>
                    <pre className="mt-2 max-h-48 overflow-auto rounded bg-secondary/60 p-2 text-[10px]">
                      {JSON.stringify(jsonLd, null, 2)}
                    </pre>
                  </details>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: realtime SEO audit */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">SEO score</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-4">
                <svg viewBox="0 0 80 80" className="size-20">
                  <circle
                    cx="40"
                    cy="40"
                    r="34"
                    fill="none"
                    className="stroke-secondary"
                    strokeWidth="8"
                  />
                  <circle
                    cx="40"
                    cy="40"
                    r="34"
                    fill="none"
                    className="stroke-brand"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={`${(audit.score / 100) * 213.6} 213.6`}
                    transform="rotate(-90 40 40)"
                  />
                  <text
                    x="40"
                    y="45"
                    textAnchor="middle"
                    className="fill-foreground text-lg font-bold"
                  >
                    {audit.score}
                  </text>
                </svg>
                <div className="text-xs text-muted-foreground">
                  <p>{audit.wordCount} words</p>
                  <p>Grade {audit.grade} readability</p>
                  <p>{audit.density}% keyword density</p>
                </div>
              </div>

              <ul className="space-y-1.5 text-xs">
                {audit.checks.map((c) => (
                  <li key={c.id} className="flex items-center gap-2">
                    {c.passed ? (
                      <Check className="size-3.5 shrink-0 text-brand" />
                    ) : (
                      <X className="size-3.5 shrink-0 text-destructive" />
                    )}
                    <span className={c.passed ? "" : "text-muted-foreground"}>
                      {c.label}
                      {c.detail ? ` · ${c.detail}` : ""}
                    </span>
                  </li>
                ))}
              </ul>

              {secondary.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold">Secondary keywords</p>
                  <div className="flex flex-wrap gap-1">
                    {secondary.map((k) => {
                      const used = audit.usedSecondary.includes(k);
                      return (
                        <Badge
                          key={k}
                          variant={used ? "default" : "outline"}
                          className={`gap-1 text-[10px] ${used ? "bg-brand text-brand-foreground" : ""}`}
                        >
                          {used && <Check className="size-3" />}
                          {k}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              )}

              <Button
                variant="outline"
                className="w-full"
                disabled={contentHtml.length < 20 || humanizeMutation.isPending}
                onClick={() => humanizeMutation.mutate()}
              >
                {humanizeMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Wand2 className="size-4" />
                )}
                Human-tone rewrite
              </Button>
            </CardContent>
          </Card>

          {faq.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">FAQ (schema-ready)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                {faq.map((f, i) => (
                  <details key={i} className="rounded-lg border p-2">
                    <summary className="cursor-pointer font-medium">{f.q}</summary>
                    <p className="mt-1 text-muted-foreground">{f.a}</p>
                  </details>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </main>
  );
}
