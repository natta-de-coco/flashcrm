import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  composeSocialPost,
  connectSocialAccount,
  deleteSocialAccount,
  deleteSocialPost,
  getSocialHub,
  saveSocialPost,
  sendSocialReply,
  suggestSocialReply,
  syncSocialAccountFn,
  updateInteractionStatus,
} from "@/lib/social.functions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Archive,
  Facebook,
  Instagram,
  Linkedin,
  Loader2,
  MessageCircle,
  Music2,
  PenSquare,
  RefreshCw,
  Send,
  Sparkles,
  Store,
  Trash2,
  Twitter,
  Youtube,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/social")({
  head: () => ({
    meta: [
      { title: "Social Hub — Flas CRM" },
      {
        name: "description",
        content:
          "Manage Instagram and Facebook comments, DMs, content reach and audience from Flash CRM.",
      },
      { property: "og:title", content: "Social Hub — Flas CRM" },
      {
        property: "og:description",
        content:
          "Manage Instagram and Facebook comments, DMs, content reach and audience from Flash CRM.",
      },
    ],
  }),
  component: SocialHubPage,
});

type PlatformId =
  | "instagram"
  | "facebook"
  | "youtube"
  | "twitter"
  | "linkedin"
  | "tiktok"
  | "google_business";

type Account = {
  id: string;
  platform: PlatformId;
  label: string;
  external_id: string | null;
  active: boolean;
  last_synced_at: string | null;
  stats: Record<string, number> | null;
};

/** Per-platform connect form metadata: what the ID and token fields mean. */
const PLATFORMS: {
  id: PlatformId;
  label: string;
  icon: LucideIcon;
  idLabel: string;
  idPlaceholder: string;
  tokenLabel: string;
  tokenPlaceholder: string;
  hint: string;
}[] = [
  {
    id: "instagram",
    label: "Instagram",
    icon: Instagram,
    idLabel: "IG user ID",
    idPlaceholder: "Instagram professional account ID",
    tokenLabel: "Meta access token",
    tokenPlaceholder: "Long-lived Meta token",
    hint: "Meta for Developers → your app → Instagram Graph API. Needs instagram_manage_comments.",
  },
  {
    id: "facebook",
    label: "Facebook Page",
    icon: Facebook,
    idLabel: "Page ID",
    idPlaceholder: "Facebook Page ID",
    tokenLabel: "Meta access token",
    tokenPlaceholder: "Page access token",
    hint: "Page token with pages_read_engagement (and pages_messaging for DMs).",
  },
  {
    id: "youtube",
    label: "YouTube channel",
    icon: Youtube,
    idLabel: "Channel ID",
    idPlaceholder: "UC…",
    tokenLabel: "YouTube Data API key",
    tokenPlaceholder: "AIza…",
    hint: "Google Cloud Console → enable YouTube Data API v3 → Credentials → API key.",
  },
  {
    id: "twitter",
    label: "X (Twitter)",
    icon: Twitter,
    idLabel: "Numeric user ID",
    idPlaceholder: "e.g. 1234567890",
    tokenLabel: "Bearer token",
    tokenPlaceholder: "AAA…",
    hint: "developer.x.com → your project app → Keys and Tokens → Bearer Token.",
  },
  {
    id: "linkedin",
    label: "LinkedIn Page",
    icon: Linkedin,
    idLabel: "Organization ID",
    idPlaceholder: "Numbers only, e.g. 12345678",
    tokenLabel: "OAuth access token",
    tokenPlaceholder: "AQV…",
    hint: "LinkedIn Developer app with w_organization_social scope.",
  },
  {
    id: "tiktok",
    label: "TikTok Business",
    icon: Music2,
    idLabel: "Open ID (optional)",
    idPlaceholder: "Leave blank to use the token's account",
    tokenLabel: "Access token",
    tokenPlaceholder: "act.…",
    hint: "TikTok for Developers → your app → video.list and user.info.basic scopes.",
  },
  {
    id: "google_business",
    label: "Google Business",
    icon: Store,
    idLabel: "Location path",
    idPlaceholder: "accounts/123/locations/456",
    tokenLabel: "Google OAuth token",
    tokenPlaceholder: "ya29.…",
    hint: "Pulls your latest Google reviews so Flash AI can draft responses.",
  },
];

function platformMeta(id: string) {
  return PLATFORMS.find((p) => p.id === id) ?? PLATFORMS[0]!;
}

/** First useful audience number from a sync, if any. */
function audienceStat(stats: Account["stats"]): string | null {
  if (!stats) return null;
  const order: [string, string][] = [
    ["followers", "followers"],
    ["subscribers", "subscribers"],
    ["reviews", "reviews"],
    ["videos", "videos"],
    ["tweets", "posts"],
  ];
  for (const [key, label] of order) {
    const value = stats[key];
    if (typeof value === "number") return `${value.toLocaleString()} ${label}`;
  }
  return null;
}

type Interaction = {
  id: string;
  account_id: string;
  kind: "comment" | "dm";
  direction: "in" | "out";
  author_name: string | null;
  author_handle: string | null;
  body: string;
  status: "open" | "replied" | "archived";
  ai_suggestion: string | null;
  created_at: string;
};

type Post = {
  id: string;
  account_id: string | null;
  caption: string;
  status: "draft" | "scheduled" | "published";
  scheduled_at: string | null;
  published_at: string | null;
  reach: number;
  likes: number;
  comments_count: number;
  shares: number;
};

function timeAgo(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function PlatformIcon({ platform }: { platform: string }) {
  const Icon = platformMeta(platform).icon;
  return <Icon className="size-3.5" />;
}

function SocialHubPage() {
  const qc = useQueryClient();
  const hubFn = useServerFn(getSocialHub);
  const hub = useQuery({ queryKey: ["social-hub"], queryFn: () => hubFn() });
  const refresh = () => qc.invalidateQueries({ queryKey: ["social-hub"] });

  const accounts = (hub.data?.accounts ?? []) as Account[];
  const interactions = ((hub.data?.interactions ?? []) as Interaction[]).filter(
    (i) => i.direction === "in",
  );
  const posts = (hub.data?.posts ?? []) as Post[];

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-6">
      <PageHeader
        title="Social Hub"
        description="Run your client's whole social presence from here: reply to comments & DMs with Flash AI, write posts, and watch reach and audience grow."
      />

      <AccountsCard accounts={accounts} onChanged={refresh} />

      <Tabs defaultValue="inbox" className="mt-6">
        <TabsList>
          <TabsTrigger value="inbox" className="gap-1.5">
            <MessageCircle className="size-3.5" /> Comments & DMs
            {interactions.filter((i) => i.status === "open").length > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px]">
                {interactions.filter((i) => i.status === "open").length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="composer" className="gap-1.5">
            <PenSquare className="size-3.5" /> AI Composer
          </TabsTrigger>
          <TabsTrigger value="reach" className="gap-1.5">
            <Sparkles className="size-3.5" /> Reach & audience
          </TabsTrigger>
        </TabsList>

        <TabsContent value="inbox" className="mt-4">
          <InboxTab interactions={interactions} accounts={accounts} onChanged={refresh} />
        </TabsContent>
        <TabsContent value="composer" className="mt-4">
          <ComposerTab onChanged={refresh} />
        </TabsContent>
        <TabsContent value="reach" className="mt-4">
          <ReachTab posts={posts} interactions={interactions} accounts={accounts} onChanged={refresh} />
        </TabsContent>
      </Tabs>
    </main>
  );
}

/* ---------------- Accounts ---------------- */

function AccountsCard({
  accounts,
  onChanged,
}: {
  accounts: Account[];
  onChanged: () => void;
}) {
  const connect = useServerFn(connectSocialAccount);
  const remove = useServerFn(deleteSocialAccount);
  const sync = useServerFn(syncSocialAccountFn);
  const [form, setForm] = useState({
    platform: "instagram" as "instagram" | "facebook",
    label: "",
    externalId: "",
    accessToken: "",
  });
  const [showForm, setShowForm] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const connectMutation = useMutation({
    mutationFn: () => connect({ data: form }),
    onSuccess: () => {
      toast.success("Account connected — press Sync to pull comments & DMs");
      setForm({ platform: "instagram", label: "", externalId: "", accessToken: "" });
      setShowForm(false);
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function runSync(id: string) {
    setSyncingId(id);
    try {
      const result = await sync({ data: { id } });
      if (result.ok) {
        toast.success(`Synced ${result.posts} posts and ${result.interactions} comments/DMs`);
      } else {
        toast.error(result.error ?? "Sync failed");
      }
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncingId(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Connected accounts</CardTitle>
          <CardDescription>
            Link each client's Instagram professional account or Facebook Page with a Meta access
            token, then sync to pull in comments, DMs and post stats.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Close" : "Connect account"}
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3">
        {showForm && (
          <div className="grid gap-3 rounded-lg border border-dashed p-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Platform</Label>
              <Select
                value={form.platform}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, platform: v as "instagram" | "facebook" }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="instagram">Instagram</SelectItem>
                  <SelectItem value="facebook">Facebook Page</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Display name</Label>
              <Input
                placeholder="e.g. Client's bakery IG"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Meta account ID</Label>
              <Input
                placeholder="IG user ID or Page ID"
                value={form.externalId}
                onChange={(e) => setForm((f) => ({ ...f, externalId: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Access token</Label>
              <Input
                type="password"
                placeholder="Long-lived Meta token"
                value={form.accessToken}
                onChange={(e) => setForm((f) => ({ ...f, accessToken: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-2">
              <Button
                size="sm"
                disabled={form.label.trim().length < 2 || connectMutation.isPending}
                onClick={() => connectMutation.mutate()}
              >
                {connectMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
                Save account
              </Button>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Tokens are stored encrypted-at-rest and are never shown back in the app.
              </p>
            </div>
          </div>
        )}

        {accounts.length === 0 && !showForm && (
          <p className="text-sm text-muted-foreground">
            No social accounts yet. Connect one to start managing comments, DMs and reach.
          </p>
        )}

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border p-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <PlatformIcon platform={a.platform} />
                  <span className="truncate">{a.label}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {a.last_synced_at ? `Synced ${timeAgo(a.last_synced_at)}` : "Never synced"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  disabled={syncingId === a.id}
                  onClick={() => void runSync(a.id)}
                >
                  {syncingId === a.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3.5" />
                  )}
                  Sync
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    void remove({ data: { id: a.id } })
                      .then(() => {
                        toast.success("Account removed");
                        onChanged();
                      })
                      .catch((e: Error) => toast.error(e.message));
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------- Inbox (comments & DMs) ---------------- */

function InboxTab({
  interactions,
  accounts,
  onChanged,
}: {
  interactions: Interaction[];
  accounts: Account[];
  onChanged: () => void;
}) {
  const suggest = useServerFn(suggestSocialReply);
  const send = useServerFn(sendSocialReply);
  const setStatus = useServerFn(updateInteractionStatus);
  const [filter, setFilter] = useState<"all" | "comment" | "dm">("all");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const accountLabel = (id: string) => accounts.find((a) => a.id === id)?.label ?? "Account";
  const accountPlatform = (id: string) =>
    accounts.find((a) => a.id === id)?.platform ?? "instagram";

  const visible = interactions.filter(
    (i) => i.status !== "archived" && (filter === "all" || i.kind === filter),
  );

  async function handleSuggest(i: Interaction) {
    setBusyId(i.id);
    try {
      const { suggestion } = await suggest({ data: { id: i.id } });
      setDrafts((d) => ({ ...d, [i.id]: suggestion }));
      toast.success("Flash AI drafted a reply");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Drafting failed");
    } finally {
      setBusyId(null);
    }
  }

  async function handleSend(i: Interaction) {
    const reply = (drafts[i.id] ?? i.ai_suggestion ?? "").trim();
    if (!reply) return;
    setBusyId(i.id);
    try {
      const { metaDelivered } = await send({ data: { id: i.id, reply } });
      toast.success(
        metaDelivered ? "Reply sent to the platform" : "Reply recorded (platform delivery not confirmed)",
      );
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Send failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="grid max-w-4xl gap-3">
      <div className="flex gap-1.5">
        {(["all", "comment", "dm"] as const).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All" : f === "comment" ? "Comments" : "DMs"}
          </Button>
        ))}
      </div>

      {visible.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Nothing here yet. Connect an account above and press Sync — new comments and DMs will
            appear here with AI-suggested replies.
          </CardContent>
        </Card>
      )}

      {visible.map((i) => (
        <Card key={i.id} className={i.status === "replied" ? "opacity-70" : undefined}>
          <CardContent className="grid gap-3 pt-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="gap-1 text-[10px]">
                <PlatformIcon platform={accountPlatform(i.account_id)} />
                {accountLabel(i.account_id)}
              </Badge>
              <Badge variant="outline" className="text-[10px] uppercase">
                {i.kind === "dm" ? "DM" : "Comment"}
              </Badge>
              <Badge
                variant={i.status === "open" ? "default" : "secondary"}
                className="text-[10px] capitalize"
              >
                {i.status}
              </Badge>
              <span className="ml-auto text-xs text-muted-foreground">{timeAgo(i.created_at)}</span>
            </div>
            <div>
              <p className="text-sm font-semibold">
                {i.author_name ?? "Unknown"}
                {i.author_handle ? (
                  <span className="font-normal text-muted-foreground"> @{i.author_handle}</span>
                ) : null}
              </p>
              <p className="mt-0.5 text-sm">{i.body}</p>
            </div>

            {i.status !== "replied" && (
              <div className="grid gap-2">
                {(drafts[i.id] ?? i.ai_suggestion) != null && (
                  <Textarea
                    rows={2}
                    value={drafts[i.id] ?? i.ai_suggestion ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [i.id]: e.target.value }))}
                  />
                )}
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={busyId === i.id}
                    onClick={() => void handleSuggest(i)}
                  >
                    {busyId === i.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="size-3.5" />
                    )}
                    {i.ai_suggestion || drafts[i.id] ? "Redraft with Flash AI" : "Suggest reply"}
                  </Button>
                  {(drafts[i.id] ?? i.ai_suggestion) && (
                    <Button
                      size="sm"
                      className="gap-1.5"
                      disabled={busyId === i.id}
                      onClick={() => void handleSend(i)}
                    >
                      <Send className="size-3.5" /> Send reply
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5"
                    onClick={() => {
                      void setStatus({ data: { id: i.id, status: "archived" } })
                        .then(onChanged)
                        .catch((e: Error) => toast.error(e.message));
                    }}
                  >
                    <Archive className="size-3.5" /> Archive
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ---------------- AI Composer ---------------- */

function ComposerTab({ onChanged }: { onChanged: () => void }) {
  const compose = useServerFn(composeSocialPost);
  const save = useServerFn(saveSocialPost);
  const [form, setForm] = useState({
    topic: "",
    tone: "friendly" as "friendly" | "professional" | "bold" | "playful",
    platform: "instagram" as "instagram" | "facebook",
  });
  const [caption, setCaption] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");

  const composeMutation = useMutation({
    mutationFn: () => compose({ data: { topic: form.topic.trim(), tone: form.tone, platform: form.platform } }),
    onSuccess: (res) => {
      setCaption(res.caption);
      toast.success("Flash AI wrote your caption");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveMutation = useMutation({
    mutationFn: (scheduledAt?: string) =>
      save({
        data: {
          caption: caption.trim(),
          platform: form.platform,
          scheduledAt,
        },
      }),
    onSuccess: (_res, scheduledAt) => {
      toast.success(scheduledAt ? "Post scheduled" : "Draft saved");
      setCaption("");
      setScheduleAt("");
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="max-w-4xl">
      <CardHeader>
        <CardTitle className="text-base">Flash AI content writer</CardTitle>
        <CardDescription>
          Describe the post goal — Flash AI knows the business profile and writes an on-brand
          caption with hashtags and a call to action.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="topic">Post topic or goal</Label>
            <Input
              id="topic"
              placeholder="e.g. Announce weekend brunch menu, 20% off for WhatsApp subscribers"
              value={form.topic}
              onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Tone</Label>
            <Select
              value={form.tone}
              onValueChange={(v) => setForm((f) => ({ ...f, tone: v as typeof form.tone }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="friendly">Friendly</SelectItem>
                <SelectItem value="professional">Professional</SelectItem>
                <SelectItem value="bold">Bold</SelectItem>
                <SelectItem value="playful">Playful</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={form.platform}
            onValueChange={(v) =>
              setForm((f) => ({ ...f, platform: v as "instagram" | "facebook" }))
            }
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="instagram">Instagram</SelectItem>
              <SelectItem value="facebook">Facebook</SelectItem>
            </SelectContent>
          </Select>
          <Button
            className="gap-1.5"
            disabled={form.topic.trim().length < 3 || composeMutation.isPending}
            onClick={() => composeMutation.mutate()}
          >
            {composeMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            Draft with Flash AI
          </Button>
        </div>

        {caption && (
          <div className="grid gap-2">
            <Textarea rows={7} value={caption} onChange={(e) => setCaption(e.target.value)} />
            <p className="text-xs text-muted-foreground">{caption.length} characters</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={saveMutation.isPending}
                onClick={() => saveMutation.mutate(undefined)}
              >
                Save as draft
              </Button>
              <Input
                type="datetime-local"
                className="w-56"
                value={scheduleAt}
                onChange={(e) => setScheduleAt(e.target.value)}
              />
              <Button
                size="sm"
                disabled={!scheduleAt || saveMutation.isPending}
                onClick={() => saveMutation.mutate(new Date(scheduleAt).toISOString())}
              >
                Schedule post
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------- Reach & audience ---------------- */

function ReachTab({
  posts,
  interactions,
  accounts,
  onChanged,
}: {
  posts: Post[];
  interactions: Interaction[];
  accounts: Account[];
  onChanged: () => void;
}) {
  const remove = useServerFn(deleteSocialPost);
  const published = posts.filter((p) => p.status === "published");
  const totalReach = published.reduce((s, p) => s + p.reach, 0);
  const totalLikes = published.reduce((s, p) => s + p.likes, 0);
  const totalComments = published.reduce((s, p) => s + p.comments_count, 0);

  const open = interactions.filter((i) => i.status === "open").length;
  const replied = interactions.filter((i) => i.status === "replied").length;

  const authorCounts = new Map<string, number>();
  for (const i of interactions) {
    const key = i.author_handle ?? i.author_name;
    if (!key) continue;
    authorCounts.set(key, (authorCounts.get(key) ?? 0) + 1);
  }
  const topAuthors = [...authorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  const tiles = [
    { label: "Published posts", value: published.length },
    { label: "Total likes", value: totalLikes },
    { label: "Comments on posts", value: totalComments },
    { label: "Reach (synced)", value: totalReach },
  ];

  return (
    <div className="grid max-w-5xl gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardContent className="pt-6">
              <p className="text-2xl font-bold leading-none">{t.value.toLocaleString()}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Posts</CardTitle>
            <CardDescription>
              Drafts, scheduled posts and everything synced from the connected platforms.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {posts.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No posts yet — draft one in the AI Composer or sync a connected account.
              </p>
            )}
            {posts.map((p) => (
              <div key={p.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <p className="line-clamp-2 text-sm">{p.caption}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {p.published_at
                      ? `Published ${timeAgo(p.published_at)}`
                      : p.scheduled_at
                        ? `Scheduled ${new Date(p.scheduled_at).toLocaleString()}`
                        : "Draft"}
                    {" · "}
                    {p.likes} likes · {p.comments_count} comments
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Badge
                    variant={p.status === "published" ? "default" : "secondary"}
                    className="text-[10px] capitalize"
                  >
                    {p.status}
                  </Badge>
                  {p.status !== "published" && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        void remove({ data: { id: p.id } })
                          .then(() => {
                            toast.success("Post deleted");
                            onChanged();
                          })
                          .catch((e: Error) => toast.error(e.message));
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Audience</CardTitle>
            <CardDescription>Who is talking to you and how fast you answer.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="flex justify-between">
              <span>Open conversations</span>
              <span className="font-semibold">{open}</span>
            </div>
            <div className="flex justify-between">
              <span>Replied</span>
              <span className="font-semibold">{replied}</span>
            </div>
            <div className="flex justify-between">
              <span>Connected accounts</span>
              <span className="font-semibold">{accounts.length}</span>
            </div>
            <div className="pt-2">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Most engaged people
              </p>
              {topAuthors.length === 0 && (
                <p className="text-xs text-muted-foreground">No audience data yet.</p>
              )}
              {topAuthors.map(([name, count]) => (
                <div key={name} className="flex justify-between py-0.5">
                  <span className="truncate">{name}</span>
                  <span className="text-muted-foreground">{count} interactions</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
