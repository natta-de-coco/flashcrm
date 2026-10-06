import { ChannelReportDialog, REPORT_PLATFORMS } from "@/components/social/ChannelReportDialog";
import { syncSummary } from "@/lib/sync-report";
import { useTenant } from "@/hooks/useTenant";
import { PageHeader } from "@/components/PageHeader";
import {
  ConnectionOutcome,
  type ConnectionOutcomeSearch,
} from "@/components/integrations/ConnectionOutcome";
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
import { manualSocialFormError } from "@/lib/form-validation";
import { connector } from "@/lib/connections-catalog";
import { connectorDefinition, resolveCapability } from "@/lib/social-connector-definitions";
import { plannedPostNote, publishReality } from "@/lib/social-publishing";
import {
  groupPostsByState,
  humanizePlatformId,
  isEditablePost,
  postAttribution,
  postStatusLabel,
  sortPostsByDateDesc,
} from "@/lib/social-posts";
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
  updateSocialPost,
} from "@/lib/social.functions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Archive,
  Facebook,
  Globe,
  Info,
  Instagram,
  Linkedin,
  Loader2,
  MessageCircle,
  Music2,
  Pencil,
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
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/hooks/useI18n";
import { hasMessage, type MessageKey } from "@/lib/i18n";

type Translate = ReturnType<typeof useI18n>["t"];

export const Route = createFileRoute("/_authenticated/social")({
  head: () => ({
    meta: [
      { title: "Social Hub — Flas CRM" },
      {
        name: "description",
        content:
          "Manage Instagram and Facebook comments, DMs, content reach and audience from Flas CRM.",
      },
      { property: "og:title", content: "Social Hub — Flas CRM" },
      {
        property: "og:description",
        content:
          "Manage Instagram and Facebook comments, DMs, content reach and audience from Flas CRM.",
      },
    ],
  }),
  // The OAuth callback redirects back here with the outcome in the query
  // string. These were previously unread, so a blocked connection showed
  // nothing at all.
  validateSearch: (search: Record<string, unknown>): ConnectionOutcomeSearch => ({
    ...(typeof search["connected"] === "string" ? { connected: search["connected"] } : {}),
    ...(typeof search["connect_blocked"] === "string"
      ? { connect_blocked: search["connect_blocked"] }
      : {}),
    ...(typeof search["connect_reason"] === "string"
      ? { connect_reason: search["connect_reason"] }
      : {}),
    ...(typeof search["connect_error"] === "string"
      ? { connect_error: search["connect_error"] }
      : {}),
    ...(typeof search["connect_detail"] === "string"
      ? { connect_detail: search["connect_detail"] }
      : {}),
    ...(typeof search["connect_help"] === "string" ? { connect_help: search["connect_help"] } : {}),
    ...(typeof search["select_target"] === "string"
      ? { select_target: search["select_target"] }
      : {}),
  }),
  component: SocialHubPage,
});

type PlatformId =
  "instagram" | "facebook" | "youtube" | "twitter" | "linkedin" | "tiktok" | "google_business";

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
  /** TikTok resolves the account from the token, so its id really is optional. */
  idOptional?: boolean;
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
    idOptional: true,
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
    hint: "Pulls your latest Google reviews so Flas AI can draft responses.",
  },
];

/** The entry for a platform this screen has form metadata for, if any. */
function platformEntry(id: string | null) {
  return id ? PLATFORMS.find((p) => p.id === id) : undefined;
}

/**
 * Form metadata for the paste-a-token form, whose select only ever holds one of
 * the ids above. Display code must use `platformDisplayName` / `PlatformIcon`
 * instead: falling back to `PLATFORMS[0]` here is how a connected Pinterest or
 * Meta Ads account came to be drawn with the Instagram icon.
 */
function platformMeta(id: PlatformId) {
  return platformEntry(id) ?? PLATFORMS[0]!;
}

/** The platform's own name, never another platform's. */
function platformDisplayName(id: string | null): string {
  if (!id) return "No account";
  return platformEntry(id)?.label ?? connector(id)?.name ?? humanizePlatformId(id);
}

/** What Flas can actually do with a post on this platform. */
function publishTruth(platform: string) {
  const definition = connectorDefinition(platform);
  const capability = definition ? resolveCapability(definition, "publish") : null;
  return publishReality({
    platform,
    displayName: platformDisplayName(platform),
    publishStatus: capability?.status ?? null,
    missingScopes: capability?.missingScopes ?? [],
  });
}

/** First useful audience number from a sync, if any. */
function audienceStat(stats: Account["stats"], t: Translate): string | null {
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
    if (typeof value === "number") {
      return t(`social.stat.${label}` as MessageKey, { n: value.toLocaleString() });
    }
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
  created_at: string;
  reach: number;
  likes: number;
  comments_count: number;
  shares: number;
};

function timeAgo(iso: string, t: Translate) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return t("social.time.justNow");
  if (mins < 60) return t("social.time.minutes", { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t("social.time.hours", { n: hours });
  return t("social.time.days", { n: Math.round(hours / 24) });
}

/** A neutral globe for anything this screen has no icon for — never a guess. */
function PlatformIcon({ platform }: { platform: string | null }) {
  const Icon = platformEntry(platform)?.icon ?? Globe;
  return <Icon className="size-3.5" />;
}

/**
 * Which platform a row belongs to, always spelled out.
 *
 * The posts list showed neither, so the Instagram post and the Facebook copy of
 * the same caption were two identical-looking rows (QA, 26 Sep).
 */
function PlatformBadge({ platform, label }: { platform: string | null; label?: string }) {
  return (
    <Badge variant="secondary" className="gap-1 whitespace-nowrap text-[10px]">
      <PlatformIcon platform={platform} />
      {label ?? platformDisplayName(platform)}
    </Badge>
  );
}

/** ISO instant → the value a `datetime-local` input expects, in local time. */
function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function SocialHubPage() {
  const i18n = useI18n();
  const qc = useQueryClient();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const hubFn = useServerFn(getSocialHub);
  const hub = useQuery({ queryKey: ["social-hub"], queryFn: () => hubFn() });
  const refresh = () => qc.invalidateQueries({ queryKey: ["social-hub"] });

  const accounts = (hub.data?.accounts ?? []) as Account[];
  const interactions = ((hub.data?.interactions ?? []) as Interaction[]).filter(
    (i) => i.direction === "in",
  );
  const posts = (hub.data?.posts ?? []) as Post[];
  // The composer is where a draft is written, so it is where a draft has to be
  // editable. "Edit" on a draft anywhere else brings it back here rather than
  // leaving it stranded in a list with only a delete icon (QA, 26 Sep).
  const [tab, setTab] = useState("inbox");
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const editPost = (post: Post) => {
    setEditingPost(post);
    setTab("composer");
  };

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-6">
      <PageHeader
        title={i18n.t("social.socialHub")}
        description={i18n.t("social.runYourClientSWhole")}
      />

      <ConnectionOutcome
        search={search}
        accounts={accounts}
        onChanged={refresh}
        onDismiss={() => void navigate({ to: "/social", search: {}, replace: true })}
      />

      <AccountsCard accounts={accounts} onChanged={refresh} />

      <Tabs value={tab} onValueChange={setTab} className="mt-6">
        <TabsList>
          <TabsTrigger value="inbox" className="gap-1.5">
            <MessageCircle className="size-3.5" /> {i18n.t("social.commentsDms")}
            {interactions.filter((i) => i.status === "open").length > 0 && (
              <Badge variant="secondary" className="ms-1 text-[10px]">
                {interactions.filter((i) => i.status === "open").length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="composer" className="gap-1.5">
            <PenSquare className="size-3.5" /> {i18n.t("social.aiComposer")}
          </TabsTrigger>
          <TabsTrigger value="reach" className="gap-1.5">
            <Sparkles className="size-3.5" /> {i18n.t("social.reachAudience")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="inbox" className="mt-4">
          <InboxTab interactions={interactions} accounts={accounts} onChanged={refresh} />
        </TabsContent>
        <TabsContent value="composer" className="mt-4">
          <ComposerTab
            accounts={accounts}
            posts={posts}
            editing={editingPost}
            onEdit={setEditingPost}
            onChanged={refresh}
          />
        </TabsContent>
        <TabsContent value="reach" className="mt-4">
          <ReachTab
            posts={posts}
            interactions={interactions}
            accounts={accounts}
            onEdit={editPost}
            onChanged={refresh}
          />
        </TabsContent>
      </Tabs>
    </main>
  );
}

/* ---------------- Accounts ---------------- */

function AccountsCard({ accounts, onChanged }: { accounts: Account[]; onChanged: () => void }) {
  const i18n = useI18n();
  const connect = useServerFn(connectSocialAccount);
  const remove = useServerFn(deleteSocialAccount);
  const sync = useServerFn(syncSocialAccountFn);
  const [form, setForm] = useState({
    platform: "instagram" as PlatformId,
    label: "",
    externalId: "",
    accessToken: "",
  });
  const [showForm, setShowForm] = useState(false);
  // Pasting a raw token is a developer fallback, and the RLS policy on
  // social_accounts only lets admins save one. Everyone else got an error from
  // a button that should not have been offered to them.
  const { staffRole } = useTenant();
  const canPasteToken = staffRole === "company_admin" || staffRole === "super_admin";
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const connectMutation = useMutation({
    mutationFn: () => connect({ data: form }),
    onSuccess: () => {
      toast.success(i18n.t("social.accountConnectedPressSyncTo"));
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
      // A sync that read the posts but not the comments is not a success. Saying
      // which section was refused, and why, is how a workspace finds out that a
      // permission is missing instead of concluding the product is broken.
      const summary = syncSummary(result);
      if (summary.tone === "success") toast.success(summary.text);
      else if (summary.tone === "warning")
        toast.warning(summary.text, { description: summary.detail });
      else toast.error(summary.text);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : i18n.t("social.syncFailed"));
    } finally {
      setSyncingId(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">{i18n.t("social.connectedAccounts")}</CardTitle>
          <CardDescription>{i18n.t("social.linkInstagramFacebookYoutubeX")}</CardDescription>
        </div>
        {/* Connecting has one front door -- the guided flow on Connect & setup,
            which runs the platform's real login. This card used to offer a
            competing "Connect account" button that only took a hand-pasted
            token, so the same job had two different answers depending on which
            page you happened to be on. The manual path still exists for
            long-lived tokens, but it is now clearly the fallback. */}
        <div className="flex items-center gap-2">
          <Button asChild size="sm">
            <Link to="/connect">{i18n.t("social.connectAnAccount")}</Link>
          </Button>
          {canPasteToken ? (
            <Button size="sm" variant="ghost" onClick={() => setShowForm((v) => !v)}>
              {showForm ? i18n.t("social.close") : i18n.t("social.pasteAToken")}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {showForm && canPasteToken && (
          <div className="grid gap-3 rounded-lg border border-dashed p-4 sm:grid-cols-2">
            <p className="text-xs text-muted-foreground sm:col-span-2">
              {i18n.tr("social.advancedMostAccountsShouldBe", {
                link: (
                  <Link to="/connect" className="underline underline-offset-2">
                    {i18n.t("social.connectSetup")}
                  </Link>
                ),
              })}
            </p>
            <div className="grid gap-1.5">
              <Label>{i18n.t("social.platform")}</Label>
              <Select
                value={form.platform}
                onValueChange={(v) => setForm((f) => ({ ...f, platform: v as PlatformId }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="flex items-center gap-2">
                        <p.icon className="size-3.5" /> {p.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="social-label">{i18n.t("social.displayName")}</Label>
              <Input
                id="social-label"
                name="social-account-label"
                autoComplete="off"
                placeholder={i18n.t("social.eGClientSBakery")}
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="social-external-id">{platformMeta(form.platform).idLabel}</Label>
              <Input
                id="social-external-id"
                // Unnamed, this looked like a generic text field and the browser
                // filled it with the saved CRM login email.
                name="social-account-external-id"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder={platformMeta(form.platform).idPlaceholder}
                value={form.externalId}
                onChange={(e) => setForm((f) => ({ ...f, externalId: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="social-access-token">{platformMeta(form.platform).tokenLabel}</Label>
              <Input
                id="social-access-token"
                name="social-account-token"
                type="password"
                // A pasted API credential, not a password to remember.
                // new-password is what stops a manager offering the saved login;
                // the vendor opt-outs stop 1Password and LastPass overlaying it.
                autoComplete="new-password"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
                placeholder={platformMeta(form.platform).tokenPlaceholder}
                value={form.accessToken}
                onChange={(e) => setForm((f) => ({ ...f, accessToken: e.target.value }))}
              />
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              {platformMeta(form.platform).hint}
            </p>
            <div className="sm:col-span-2">
              <Button
                size="sm"
                disabled={
                  manualSocialFormError(form, platformMeta(form.platform)) !== null ||
                  connectMutation.isPending
                }
                onClick={() => connectMutation.mutate()}
              >
                {connectMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
                {i18n.t("social.saveAccount")}
              </Button>
              {manualSocialFormError(form, platformMeta(form.platform)) ? (
                <p className="mt-1.5 text-xs text-destructive">
                  {manualSocialFormError(form, platformMeta(form.platform))}
                </p>
              ) : null}
              <p className="mt-1.5 text-xs text-muted-foreground">
                {i18n.t("social.tokensAreStoredServerSide")}
              </p>
            </div>
          </div>
        )}

        {accounts.length === 0 && !showForm && (
          <p className="text-sm text-muted-foreground">
            {i18n.t("social.noSocialAccountsYetConnect")}
          </p>
        )}

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between gap-2 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <PlatformIcon platform={a.platform} />
                  <span className="truncate">{a.label}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {!a.external_id
                    ? i18n.t("social.signInDoneChooseWhich")
                    : `${audienceStat(a.stats, i18n.t) ? `${audienceStat(a.stats, i18n.t)} · ` : ""}${
                        a.last_synced_at
                          ? i18n.t("social.synced", { timeAgo: timeAgo(a.last_synced_at, i18n.t) })
                          : i18n.t("social.neverSynced")
                      }`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {/* Analytics and ads connections report rather than sync:
                    Sync pulls posts and comments, which they do not have. */}
                {!a.external_id ? (
                  // The sign-in finished but no Page was chosen, so there is
                  // nothing to sync -- pressing Sync could only ever fail with
                  // "Add the Meta account ID and access token first", which is
                  // nonsense for a connection made by signing in.
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/connect">{i18n.t("social.finishConnecting")}</Link>
                  </Button>
                ) : REPORT_PLATFORMS.has(a.platform) ? (
                  <ChannelReportDialog accountId={a.id} label={a.label} />
                ) : (
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
                    {i18n.t("social.sync")}
                  </Button>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    void remove({ data: { id: a.id } })
                      .then(() => {
                        toast.success(i18n.t("social.accountRemoved"));
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
  const i18n = useI18n();
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
      toast.success(i18n.t("social.flasAiDraftedAReply"));
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : i18n.t("social.draftingFailed"));
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
        metaDelivered
          ? i18n.t("social.replySentToThePlatform")
          : i18n.t("social.replyRecordedPlatformDeliveryNot"),
      );
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : i18n.t("social.sendFailed"));
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
            {f === "all"
              ? i18n.t("social.all")
              : f === "comment"
                ? i18n.t("social.comments")
                : i18n.t("social.dms")}
          </Button>
        ))}
      </div>

      {visible.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            {i18n.t("social.nothingHereYetConnectAn")}
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
                {i.kind === "dm" ? i18n.t("social.dm") : i18n.t("social.comment")}
              </Badge>
              <Badge
                variant={i.status === "open" ? "default" : "secondary"}
                className="text-[10px] capitalize"
              >
                {i18n.t(`social.status.${i.status}` as MessageKey)}
              </Badge>
              <span className="ms-auto text-xs text-muted-foreground">
                {timeAgo(i.created_at, i18n.t)}
              </span>
            </div>
            <div>
              <p className="text-sm font-semibold">
                {i.author_name ?? i18n.t("social.unknown")}
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
                    {i.ai_suggestion || drafts[i.id]
                      ? i18n.t("social.redraftWithFlasAi")
                      : i18n.t("social.suggestReply")}
                  </Button>
                  {(drafts[i.id] ?? i.ai_suggestion) && (
                    <Button
                      size="sm"
                      className="gap-1.5"
                      disabled={busyId === i.id}
                      onClick={() => void handleSend(i)}
                    >
                      <Send className="size-3.5" /> {i18n.t("social.sendReply")}
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
                    <Archive className="size-3.5" /> {i18n.t("social.archive")}
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

function ComposerTab({
  accounts,
  posts,
  editing,
  onEdit,
  onChanged,
}: {
  accounts: Account[];
  posts: Post[];
  editing: Post | null;
  onEdit: (post: Post | null) => void;
  onChanged: () => void;
}) {
  const i18n = useI18n();
  const compose = useServerFn(composeSocialPost);
  const save = useServerFn(saveSocialPost);
  const update = useServerFn(updateSocialPost);
  const remove = useServerFn(deleteSocialPost);
  const [form, setForm] = useState({
    topic: "",
    tone: "friendly" as "friendly" | "professional" | "bold" | "playful",
  });
  // One piece of work in the composer: a new caption, or the draft being
  // rewritten. `id` is what tells the two apart on save.
  const [draft, setDraft] = useState<{
    id: string | null;
    caption: string;
    platform: PlatformId;
    accountId: string | null;
    plannedAt: string;
  }>({ id: null, caption: "", platform: "instagram", accountId: null, plannedAt: "" });

  // Accounts a post can be written for. The composer's own platform list is
  // what the server accepts (ComposeSchema / SavePostSchema), so an analytics or
  // ads connection is not offered a caption it could never carry.
  const writableAccounts = accounts.filter((a) => PLATFORMS.some((p) => p.id === a.platform));
  const accountPlatform = (id: string | null) =>
    (writableAccounts.find((a) => a.id === id)?.platform as PlatformId | undefined) ?? null;

  useEffect(() => {
    if (!editing) return;
    setDraft((d) => ({
      id: editing.id,
      caption: editing.caption,
      accountId: editing.account_id,
      platform:
        ((writableAccounts.find((a) => a.id === editing.account_id)?.platform as PlatformId) ??
          d.platform) ||
        "instagram",
      plannedAt: toLocalInputValue(editing.scheduled_at),
    }));
    // Only the identity of the post being edited should reload the form —
    // re-running on every account refetch would throw away typing in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id]);

  const reality = publishTruth(draft.platform);
  const groups = groupPostsByState(posts);
  const saved = [...groups.planned, ...groups.drafts];

  const resetDraft = () => {
    setDraft({ id: null, caption: "", platform: draft.platform, accountId: null, plannedAt: "" });
    onEdit(null);
  };

  const composeMutation = useMutation({
    mutationFn: () =>
      compose({ data: { topic: form.topic.trim(), tone: form.tone, platform: draft.platform } }),
    onSuccess: (res) => {
      setDraft((d) => ({ ...d, caption: res.caption }));
      toast.success(i18n.t("social.flasAiWroteYourCaption"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveMutation = useMutation({
    mutationFn: async (plan: boolean) => {
      const caption = draft.caption.trim();
      const scheduledAt =
        plan && draft.plannedAt ? new Date(draft.plannedAt).toISOString() : undefined;
      if (draft.id) {
        return update({
          data: {
            id: draft.id,
            caption,
            accountId: draft.accountId,
            scheduledAt: scheduledAt ?? null,
          },
        });
      }
      return save({
        data: {
          caption,
          platform: draft.platform,
          ...(draft.accountId ? { accountId: draft.accountId } : {}),
          ...(scheduledAt ? { scheduledAt } : {}),
        },
      });
    },
    onSuccess: (_res, plan) => {
      toast.success(
        draft.id
          ? i18n.t("social.draftUpdated")
          : plan
            ? i18n.t("social.savedWithAPlannedDate")
            : i18n.t("social.draftSaved"),
      );
      resetDraft();
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="grid max-w-4xl gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {draft.id ? i18n.t("social.editDraft") : i18n.t("social.flasAiContentWriter")}
          </CardTitle>
          <CardDescription>{i18n.t("social.describeThePostGoalFlas")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="topic">{i18n.t("social.postTopicOrGoal")}</Label>
              <Input
                id="topic"
                placeholder={i18n.t("social.eGAnnounceWeekendBrunch")}
                value={form.topic}
                onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{i18n.t("social.tone")}</Label>
              <Select
                value={form.tone}
                onValueChange={(v) => setForm((f) => ({ ...f, tone: v as typeof form.tone }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="friendly">{i18n.t("social.friendly")}</SelectItem>
                  <SelectItem value="professional">{i18n.t("social.professional")}</SelectItem>
                  <SelectItem value="bold">{i18n.t("social.bold")}</SelectItem>
                  <SelectItem value="playful">{i18n.t("social.playful")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Which account this is for. The save already accepted an account id;
              nothing ever sent one, so every draft was filed against whichever
              account of that platform happened to be found first. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>{i18n.t("social.account")}</Label>
              <Select
                value={draft.accountId ?? "none"}
                onValueChange={(v) =>
                  setDraft((d) => {
                    const accountId = v === "none" ? null : v;
                    return {
                      ...d,
                      accountId,
                      platform: accountPlatform(accountId) ?? d.platform,
                    };
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{i18n.t("social.noAccountKeepAsA")}</SelectItem>
                  {writableAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <span className="flex items-center gap-2">
                        <PlatformIcon platform={a.platform} /> {a.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {writableAccounts.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {i18n.tr("social.noAccountCanCarryA", {
                    link: (
                      <Link to="/connect" className="underline underline-offset-2">
                        {i18n.t("social.connectOne")}
                      </Link>
                    ),
                  })}
                </p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <Label>{i18n.t("social.platform")}</Label>
              <Select
                value={draft.platform}
                disabled={draft.accountId !== null}
                onValueChange={(v) => setDraft((d) => ({ ...d, platform: v as PlatformId }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="flex items-center gap-2">
                        <p.icon className="size-3.5" /> {p.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {draft.accountId !== null ? (
                <p className="text-xs text-muted-foreground">
                  {i18n.tr("social.setByTheAccountYou", {
                    platformDisplayName: platformDisplayName(draft.platform),
                  })}
                </p>
              ) : null}
            </div>
          </div>

          <Button
            className="w-fit gap-1.5"
            disabled={form.topic.trim().length < 3 || composeMutation.isPending}
            onClick={() => composeMutation.mutate()}
          >
            {composeMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {draft.caption ? i18n.t("social.rewriteWithFlasAi") : i18n.t("social.draftWithFlasAi")}
          </Button>

          <div className="grid gap-2">
            <Label htmlFor="social-caption">{i18n.t("social.caption")}</Label>
            <Textarea
              id="social-caption"
              rows={7}
              placeholder={i18n.t("social.writeTheCaptionHereOr")}
              value={draft.caption}
              onChange={(e) => setDraft((d) => ({ ...d, caption: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              {i18n.tr("social.characters", { length: draft.caption.length })}
            </p>
          </div>

          {/* The honest state of publishing, per platform. Nothing in Flas sends
              a saved post, so no control here claims it will. */}
          <div className="flex gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {i18n.tr("social.saveItHereAndPost", {
                reason: reality.reason,
                platformDisplayName: platformDisplayName(draft.platform),
              })}
            </span>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <Button
              size="sm"
              disabled={draft.caption.trim().length === 0 || saveMutation.isPending}
              onClick={() => saveMutation.mutate(false)}
            >
              {saveMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
              {draft.id ? i18n.t("social.saveChanges") : i18n.t("social.saveAsDraft")}
            </Button>
            <div className="grid gap-1.5">
              <Label htmlFor="social-planned-at" className="text-xs font-normal">
                {i18n.t("social.plannedDateOptional")}
              </Label>
              <Input
                id="social-planned-at"
                type="datetime-local"
                className="w-56"
                value={draft.plannedAt}
                onChange={(e) => setDraft((d) => ({ ...d, plannedAt: e.target.value }))}
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={
                !draft.plannedAt || draft.caption.trim().length === 0 || saveMutation.isPending
              }
              onClick={() => saveMutation.mutate(true)}
            >
              {draft.id ? i18n.t("social.saveWithThisPlan") : i18n.t("social.saveWithAPlannedDate")}
            </Button>
            {draft.id || draft.caption ? (
              <Button size="sm" variant="ghost" onClick={resetDraft}>
                {draft.id ? i18n.t("social.stopEditing") : i18n.t("social.clear")}
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">{plannedPostNote(reality.canSchedule)}</p>
        </CardContent>
      </Card>

      {/* A saved draft used to vanish from here and reappear only in "Reach &
          audience" with a delete icon, where it could not be edited. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{i18n.t("social.yourDrafts")}</CardTitle>
          <CardDescription>{i18n.t("social.everythingWrittenHereAndNot")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {saved.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {i18n.t("social.noDraftsYetAnythingYou")}
            </p>
          )}
          {saved.map((p) => (
            <PostRow
              key={p.id}
              post={p}
              accounts={accounts}
              highlighted={p.id === draft.id}
              onEdit={() => onEdit(p)}
              onDeleted={onChanged}
              remove={remove}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------------- Post row (shared by the composer and Reach) ---------------- */

function PostRow({
  post,
  accounts,
  highlighted,
  onEdit,
  onDeleted,
  remove,
}: {
  post: Post;
  accounts: Account[];
  highlighted?: boolean;
  onEdit: () => void;
  onDeleted: () => void;
  remove: (args: { data: { id: string } }) => Promise<unknown>;
}) {
  const i18n = useI18n();
  const who = postAttribution(post, accounts);
  const editable = isEditablePost(post);
  return (
    <div
      className={`flex items-start justify-between gap-3 rounded-lg border p-3 ${
        highlighted ? "border-primary bg-primary/5" : ""
      }`}
    >
      <div className="min-w-0">
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          <PlatformBadge platform={who.platform} />
          <span className="truncate text-xs text-muted-foreground">{who.label}</span>
        </div>
        <p className="line-clamp-2 text-sm">{post.caption}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {post.published_at
            ? i18n.t("social.published", { timeAgo: timeAgo(post.published_at, i18n.t) })
            : post.scheduled_at
              ? i18n.t("social.plannedForNotPostedBy", {
                  toLocaleString: new Date(post.scheduled_at).toLocaleString(),
                })
              : i18n.t("social.draftNotPostedByFlas")}
          {post.status === "published" ? (
            <>
              {i18n.tr("social.likesComments", {
                value: " · ",
                likes: post.likes,
                commentscount: post.comments_count,
              })}
            </>
          ) : null}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Badge
          variant={post.status === "published" ? "default" : "secondary"}
          className="text-[10px]"
        >
          {hasMessage(`social.postStatus.${post.status}`)
            ? i18n.t(`social.postStatus.${post.status}` as MessageKey)
            : postStatusLabel(post.status)}
        </Badge>
        {editable && (
          <>
            <Button
              size="icon"
              variant="ghost"
              title={i18n.t("social.editThisDraft")}
              onClick={onEdit}
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              title={i18n.t("social.deleteThisDraft")}
              onClick={() => {
                void remove({ data: { id: post.id } })
                  .then(() => {
                    toast.success(i18n.t("social.postDeleted"));
                    onDeleted();
                  })
                  .catch((e: Error) => toast.error(e.message));
              }}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------- Reach & audience ---------------- */

function ReachTab({
  posts,
  interactions,
  accounts,
  onEdit,
  onChanged,
}: {
  posts: Post[];
  interactions: Interaction[];
  accounts: Account[];
  onEdit: (post: Post) => void;
  onChanged: () => void;
}) {
  const i18n = useI18n();
  const remove = useServerFn(deleteSocialPost);
  const published = posts.filter((p) => p.status === "published");
  const totalReach = published.reduce((s, p) => s + p.reach, 0);
  const totalLikes = published.reduce((s, p) => s + p.likes, 0);
  const totalComments = published.reduce((s, p) => s + p.comments_count, 0);

  const open = interactions.filter((i) => i.status === "open").length;
  const replied = interactions.filter((i) => i.status === "replied").length;

  // Newest first by the post's own date. The query sorts by `created_at`, which
  // is when a sync wrote the row, so a first sync landed a decade of posts in
  // effectively one instant and the list read at random (QA, 26 Sep).
  const ordered = sortPostsByDateDesc(posts);

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
              <p className="stat-label">{t.label}</p>
              <p className="stat-figure mt-1.5 text-[1.75rem] font-bold">
                {t.value.toLocaleString()}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{i18n.t("social.posts")}</CardTitle>
            <CardDescription>{i18n.t("social.draftsPlannedPostsAndEverything")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {ordered.length === 0 && (
              <p className="text-sm text-muted-foreground">{i18n.t("social.noPostsYetDraftOne")}</p>
            )}
            {ordered.map((p) => (
              <PostRow
                key={p.id}
                post={p}
                accounts={accounts}
                onEdit={() => onEdit(p)}
                onDeleted={onChanged}
                remove={remove}
              />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{i18n.t("social.audience")}</CardTitle>
            <CardDescription>{i18n.t("social.whoIsTalkingToYou")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="flex justify-between">
              <span>{i18n.t("social.openConversations")}</span>
              <span className="font-semibold">{open}</span>
            </div>
            <div className="flex justify-between">
              <span>{i18n.t("social.replied")}</span>
              <span className="font-semibold">{replied}</span>
            </div>
            <div className="flex justify-between">
              <span>{i18n.t("social.connectedAccounts")}</span>
              <span className="font-semibold">{accounts.length}</span>
            </div>
            <div className="pt-2">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {i18n.t("social.mostEngagedPeople")}
              </p>
              {topAuthors.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {i18n.t("social.noAudienceDataYet")}
                </p>
              )}
              {topAuthors.map(([name, count]) => (
                <div key={name} className="flex justify-between py-0.5">
                  <span className="truncate">{name}</span>
                  <span className="text-muted-foreground">
                    {i18n.tr("social.interactions", { count: count })}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
