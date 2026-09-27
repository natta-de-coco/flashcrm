// Server-only helpers for the Social Hub: multi-platform syncing (Meta,
// YouTube, X, LinkedIn, TikTok, Google Business), AI reply drafting and AI
// content composing. Tenant data flows through the caller's RLS-scoped
// client; only social account tokens are read via the admin client.
import { openSecret } from "@/lib/secret-box.server";
import { LINKEDIN_API_VERSION } from "@/lib/linkedin";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { aiOptionsFor, callFlashAi, getBusinessContext } from "./flash-ai.server";

type RlsClient = {
  from: (table: string) => never;
};

export type SocialPlatform =
  "instagram" | "facebook" | "youtube" | "twitter" | "linkedin" | "tiktok" | "google_business";

export type SocialAccountSecret = {
  id: string;
  tenant_id: string;
  platform: SocialPlatform;
  external_id: string | null;
  access_token: string | null;
  /** "oauth" for a connection made through the provider login; otherwise pasted. */
  connect_method: string | null;
};

import type { SkippedSection } from "@/lib/sync-report";

export type SyncResult = {
  ok: boolean;
  posts: number;
  interactions: number;
  error?: string;
  /**
   * Sections the provider refused. A sync that read the posts but not the
   * comments is not a success: without this the product reported
   * "synced, 0 interactions" and threw the reason away.
   */
  skipped?: SkippedSection[];
};

const GRAPH = "https://graph.facebook.com/v21.0";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function graphGet(path: string, token: string): Promise<any> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${GRAPH}${path}${sep}access_token=${encodeURIComponent(token)}`);
  const json: any = await res.json().catch(() => ({}));
  if (json?.error) throw new Error(json.error.message ?? "Meta API error");
  if (!res.ok) throw new Error(`Meta API returned HTTP ${res.status}`);
  return json;
}

/* ---------- shared persistence helpers ---------- */

async function savePost(
  account: SocialAccountSecret,
  post: {
    external_id: string;
    caption: string;
    published_at?: string | null;
    likes?: number;
    comments_count?: number;
    shares?: number;
    reach?: number;
  },
): Promise<boolean> {
  const { error } = await supabaseAdmin.from("social_posts").upsert(
    {
      tenant_id: account.tenant_id,
      account_id: account.id,
      status: "published",
      likes: 0,
      comments_count: 0,
      shares: 0,
      reach: 0,
      ...post,
      published_at: post.published_at ?? null,
    },
    { onConflict: "account_id,external_id" },
  );
  return !error;
}

async function saveInteraction(
  account: SocialAccountSecret,
  i: {
    external_id: string;
    kind: "comment" | "dm";
    author_name: string;
    author_handle?: string | null;
    body: string;
    created_at?: string | null;
    /** "out" for something the business sent. Shown as ours, not the customer's. */
    direction?: "in" | "out";
    /** Meta's conversation id, so a DM belongs to a thread rather than standing alone. */
    thread_id?: string | null;
    /** Old history imported on a first sync is not work waiting to be done. */
    status?: "open" | "replied" | "archived";
  },
): Promise<boolean> {
  const row = {
    tenant_id: account.tenant_id,
    account_id: account.id,
    direction: "in" as "in" | "out",
    author_handle: null as string | null,
    ...i,
    created_at: i.created_at ?? new Date().toISOString(),
  };
  const { error } = await supabaseAdmin
    .from("social_interactions")
    .upsert(row, { onConflict: "account_id,external_id" });
  if (!error) return true;

  // thread_id is added by 20260927120000. Until that migration runs, PostgREST
  // rejects the whole row with 42703 rather than ignoring the unknown column, so
  // a sync would stop working between this deploy and the SQL. Retry without it:
  // threads group by author until the column exists.
  if (error.code === "42703" && "thread_id" in row) {
    const { thread_id: _dropped, ...withoutThread } = row;
    const retry = await supabaseAdmin
      .from("social_interactions")
      .upsert(withoutThread, { onConflict: "account_id,external_id" });
    return !retry.error;
  }
  return false;
}

async function finishSync(accountId: string, stats?: Record<string, number>) {
  await supabaseAdmin
    .from("social_accounts")
    .update({
      last_synced_at: new Date().toISOString(),
      ...(stats ? { stats } : {}),
    })
    .eq("id", accountId);
}

function missingCreds(message: string): SyncResult {
  return { ok: false, posts: 0, interactions: 0, error: message };
}

/* ---------- Meta (Instagram / Facebook) ---------- */

/**
 * Every id and name that means "us" for this account.
 *
 * A Page's own replies were being stored as inbound messages under the
 * customer's name, because the only check was `from.id === external_id` and the
 * id Meta reports does not always equal the id stored on the row -- a Page
 * connected through a different route, or an Instagram row pointed at the Page,
 * both break that single comparison. Asking the token who it belongs to, and
 * keeping the name as a second signal, means a reply we sent is recognized as
 * ours whichever id it arrives under.
 */
async function selfIdentity(
  account: SocialAccountSecret,
  token: string,
): Promise<{ ids: Set<string>; name: string | null; handles: Set<string> }> {
  const ids = new Set<string>();
  const handles = new Set<string>();
  if (account.external_id) ids.add(String(account.external_id));
  let name: string | null = null;
  try {
    const me = await graphGet(`/me?fields=id,name`, token);
    if (me?.id) ids.add(String(me.id));
    if (typeof me?.name === "string") name = me.name;
  } catch {
    // Not fatal: the stored id still identifies us for the common case.
  }
  // An Instagram comment names its author by handle and carries no id we ask
  // for, while `/me` on a Page-derived token answers with the Page. So the
  // Page's display name was being compared against an Instagram handle, which
  // agree only by coincidence, and our own Instagram comments went on being
  // filed as the customer's. Ask the Instagram account what it is called.
  if (account.platform === "instagram" && account.external_id) {
    try {
      const ig = await graphGet(`/${account.external_id}?fields=id,username`, token);
      if (ig?.id) ids.add(String(ig.id));
      const handle = normalizeHandle(ig?.username);
      if (handle) handles.add(handle);
    } catch {
      // Without it, an own comment is still recognized whenever Meta sends an id.
    }
  }
  return { ids, name, handles };
}

/** A handle as it compares: no leading @, no case, no surrounding space. */
function normalizeHandle(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/^@/, "").toLowerCase() : "";
}

/** True when this comment or message was sent by the business, not the customer. */
function sentByUs(
  from: { id?: unknown; name?: unknown; handle?: unknown } | null | undefined,
  self: { ids: Set<string>; name: string | null; handles: Set<string> },
): boolean {
  if (!from) return false;
  if (from.id != null && self.ids.has(String(from.id))) return true;
  const handle = normalizeHandle(from.handle);
  if (handle && self.handles.has(handle)) return true;
  return Boolean(
    self.name && typeof from.name === "string" && from.name.trim() === self.name.trim(),
  );
}

/** What an attachment-only message says, so the thread is never a blank bubble. */
function describeAttachments(msg: {
  message?: unknown;
  attachments?: { data?: Array<{ mime_type?: unknown; name?: unknown; image_data?: unknown }> };
  sticker?: unknown;
}): string {
  const text = typeof msg.message === "string" ? msg.message.trim() : "";
  if (text) return text;
  if (msg.sticker) return "(sticker)";
  const parts = msg.attachments?.data ?? [];
  if (parts.length === 0) return "(no text)";
  const described = parts.map((a) => {
    const mime = typeof a?.mime_type === "string" ? a.mime_type : "";
    const name = typeof a?.name === "string" && a.name ? `: ${a.name}` : "";
    if (a?.image_data || mime.startsWith("image/")) return `(photo${name})`;
    if (mime.startsWith("video/")) return `(video${name})`;
    if (mime.startsWith("audio/")) return `(voice message${name})`;
    return `(attachment${name})`;
  });
  return described.join(" ");
}

/**
 * How old an item has to be, on a FIRST sync, to be filed as history rather
 * than as work waiting for a reply. Importing two years of DMs as "Open" told
 * the team they had 27 conversations to answer when most were from 2025.
 */
const HISTORY_CUTOFF_DAYS = 30;

function olderThanCutoff(at: string | null | undefined, firstSync: boolean): boolean {
  if (!firstSync || !at) return false;
  const when = Date.parse(at);
  if (!Number.isFinite(when)) return false;
  return Date.now() - when > HISTORY_CUTOFF_DAYS * 86_400_000;
}

async function syncMeta(account: SocialAccountSecret, firstSync = false): Promise<SyncResult> {
  if (!account.access_token || !account.external_id) {
    return missingCreds("Add the Meta account ID and access token first.");
  }
  const token = account.access_token;
  const self = await selfIdentity(account, token);
  let posts = 0;
  let interactions = 0;
  let stats: Record<string, number> | undefined;
  const skipped: SkippedSection[] = [];
  const { skipReason } = await import("@/lib/sync-report");
  const note = (what: string, error: unknown) => {
    skipped.push({ what, reason: skipReason(what, error) });
    console.error(`[social] ${account.platform} sync could not read ${what}:`, error);
  };

  if (account.platform === "instagram") {
    const media = await graphGet(
      `/${account.external_id}/media?fields=id,caption,like_count,comments_count,timestamp&limit=20`,
      token,
    );
    for (const m of media.data ?? []) {
      if (
        await savePost(account, {
          external_id: m.id,
          caption: m.caption ?? "(media post)",
          published_at: m.timestamp,
          likes: m.like_count ?? 0,
          comments_count: m.comments_count ?? 0,
        })
      )
        posts++;

      try {
        const comments = await graphGet(
          `/${m.id}/comments?fields=id,username,text,timestamp&limit=50`,
          token,
        );
        for (const c of comments.data ?? []) {
          const ours = sentByUs({ id: c.from?.id, handle: c.username }, self);
          if (
            await saveInteraction(account, {
              external_id: c.id,
              kind: "comment",
              author_name: c.username ?? "Instagram user",
              author_handle: c.username ?? null,
              body: c.text ?? "",
              created_at: c.timestamp,
              direction: ours ? "out" : "in",
              ...(ours || olderThanCutoff(c.timestamp, firstSync)
                ? { status: ours ? ("replied" as const) : ("archived" as const) }
                : {}),
            })
          )
            interactions++;
        }
      } catch (error) {
        // Almost always a missing instagram_manage_comments. Reported, not swallowed.
        if (!skipped.some((s) => s.what === "Instagram comments")) {
          note("Instagram comments", error);
        }
      }
    }
    try {
      const profile = await graphGet(`/${account.external_id}?fields=followers_count`, token);
      if (typeof profile?.followers_count === "number")
        stats = { followers: profile.followers_count };
    } catch (error) {
      note("Instagram profile", error);
    }
  } else {
    const feed = await graphGet(
      `/${account.external_id}/feed?fields=id,message,created_time,likes.summary(true),comments.limit(20){id,from,message,created_time}&limit=20`,
      token,
    );
    for (const p of feed.data ?? []) {
      if (
        await savePost(account, {
          external_id: p.id,
          caption: p.message ?? "(page post)",
          published_at: p.created_time,
          likes: p.likes?.summary?.total_count ?? 0,
          comments_count: p.comments?.summary?.total_count ?? 0,
        })
      )
        posts++;

      for (const c of p.comments?.data ?? []) {
        // Our own comments are stored as ours rather than skipped, so a thread
        // reads as a conversation instead of a list of unanswered customers.
        const ours = sentByUs(c.from, self);
        if (
          await saveInteraction(account, {
            external_id: c.id,
            kind: "comment",
            author_name: c.from?.name ?? "Facebook user",
            body: c.message ?? "",
            created_at: c.created_time,
            direction: ours ? "out" : "in",
            ...(ours
              ? { status: "replied" as const }
              : olderThanCutoff(c.created_time, firstSync)
                ? { status: "archived" as const }
                : {}),
          })
        )
          interactions++;
      }
    }

    // Messenger DMs — requires pages_messaging permission; best-effort.
    try {
      const convs = await graphGet(
        `/${account.external_id}/conversations?fields=messages.limit(10){id,message,from,created_time,attachments{mime_type,name,image_data},sticker}&limit=10`,
        token,
      );
      for (const conv of convs.data ?? []) {
        for (const msg of conv.messages?.data ?? []) {
          // Both directions are stored now. Our replies used to be skipped
          // entirely when the id matched and, when it did not, stored as if the
          // customer had sent them.
          const ours = sentByUs(msg.from, self);
          if (
            await saveInteraction(account, {
              external_id: msg.id,
              kind: "dm",
              author_name: ours ? (self.name ?? "You") : (msg.from?.name ?? "Messenger user"),
              body: describeAttachments(msg),
              created_at: msg.created_time,
              direction: ours ? "out" : "in",
              thread_id: conv.id ?? null,
              ...(ours
                ? { status: "replied" as const }
                : olderThanCutoff(msg.created_time, firstSync)
                  ? { status: "archived" as const }
                  : {}),
            })
          )
            interactions++;
        }
      }
    } catch (error) {
      note("Messenger conversations", error);
    }

    try {
      const page = await graphGet(
        `/${account.external_id}?fields=followers_count,fan_count`,
        token,
      );
      const followers = page?.followers_count ?? page?.fan_count;
      if (typeof followers === "number") stats = { followers };
    } catch (error) {
      note("Facebook page details", error);
    }
  }

  await finishSync(account.id, stats);
  return { ok: true, posts, interactions, ...(skipped.length ? { skipped } : {}) };
}

/* ---------- YouTube (Data API v3 — API key + channel ID) ---------- */

async function syncYouTube(account: SocialAccountSecret): Promise<SyncResult> {
  const credential = account.access_token?.trim();
  const channelId = account.external_id?.trim();
  // Two kinds of credential share this column. A connection made through
  // Google's login holds an OAuth access token, which is a credential for a
  // person and belongs in the Authorization header. A pasted connection holds
  // a YouTube Data API key, which is what `key=` is for. Sending an OAuth
  // token as `key=` is rejected by Google, so OAuth-connected channels could
  // connect but never sync.
  // Pasted connections store a YouTube Data API key, and Google API keys always
  // begin "AIza". Anything else -- an OAuth access token ("ya29...") -- goes in
  // the Authorization header, even for a caller that did not say how the
  // account was connected.
  const oauth = account.connect_method === "oauth" || !credential?.startsWith("AIza");
  if (!credential || !channelId) {
    return missingCreds(
      oauth
        ? "Reconnect YouTube: this connection has no usable token or channel."
        : "Add the channel ID (starts with UC…) and a YouTube Data API key first.",
    );
  }
  const yt = async (path: string): Promise<any> => {
    const sep = path.includes("?") ? "&" : "?";
    const res = oauth
      ? await fetch(`https://www.googleapis.com/youtube/v3${path}`, {
          headers: { Authorization: `Bearer ${credential}` },
        })
      : await fetch(
          `https://www.googleapis.com/youtube/v3${path}${sep}key=${encodeURIComponent(credential)}`,
        );
    const json: any = await res.json().catch(() => ({}));
    if (json?.error) throw new Error(json.error.message ?? "YouTube API error");
    if (!res.ok) throw new Error(`YouTube API returned HTTP ${res.status}`);
    return json;
  };

  let posts = 0;
  let interactions = 0;

  const channel = await yt(
    `/channels?part=snippet,statistics,contentDetails&id=${encodeURIComponent(channelId)}`,
  );
  const ch = channel.items?.[0];
  if (!ch) throw new Error("Channel not found — check the channel ID (it starts with UC…).");
  const stats: Record<string, number> = {
    subscribers: Number(ch.statistics?.subscriberCount ?? 0),
    totalViews: Number(ch.statistics?.viewCount ?? 0),
    videos: Number(ch.statistics?.videoCount ?? 0),
  };

  const uploads = ch.contentDetails?.relatedPlaylists?.uploads;
  const videoIds: string[] = [];
  if (uploads) {
    const items = await yt(`/playlistItems?part=snippet&playlistId=${uploads}&maxResults=10`);
    for (const it of items.items ?? []) {
      const vid = it.snippet?.resourceId?.videoId;
      if (!vid) continue;
      videoIds.push(vid);
      if (
        await savePost(account, {
          external_id: vid,
          caption: it.snippet?.title ?? "(video)",
          published_at: it.snippet?.publishedAt,
        })
      )
        posts++;
    }
    if (videoIds.length) {
      const vids = await yt(`/videos?part=statistics&id=${videoIds.join(",")}`);
      for (const v of vids.items ?? []) {
        await supabaseAdmin
          .from("social_posts")
          .update({
            likes: Number(v.statistics?.likeCount ?? 0),
            comments_count: Number(v.statistics?.commentCount ?? 0),
            reach: Number(v.statistics?.viewCount ?? 0),
          })
          .eq("account_id", account.id)
          .eq("external_id", v.id);
      }
    }
  }

  // Latest comments on the 5 most recent uploads (works with an API key).
  for (const vid of videoIds.slice(0, 5)) {
    try {
      const threads = await yt(
        `/commentThreads?part=snippet&videoId=${vid}&maxResults=20&order=time`,
      );
      for (const t of threads.items ?? []) {
        const c = t.snippet?.topLevelComment?.snippet;
        if (!c) continue;
        if (
          await saveInteraction(account, {
            external_id: t.id,
            kind: "comment",
            author_name: c.authorDisplayName ?? "YouTube viewer",
            body: c.textDisplay ?? "",
            created_at: c.publishedAt,
          })
        )
          interactions++;
      }
    } catch {
      // Comments disabled on this video — skip.
    }
  }

  await finishSync(account.id, stats);
  return { ok: true, posts, interactions };
}

/* ---------- X / Twitter (API v2 — Bearer token + numeric user ID) ---------- */

async function syncTwitter(account: SocialAccountSecret): Promise<SyncResult> {
  const token = account.access_token?.trim();
  const userId = account.external_id?.trim();
  if (!token || !userId) {
    return missingCreds("Add your numeric X user ID and a Bearer token first.");
  }
  const tw = async (path: string): Promise<any> => {
    const res = await fetch(`https://api.x.com/2${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        `X API returned HTTP ${res.status} (${json?.detail ?? json?.title ?? "check your bearer token and access tier"})`,
      );
    }
    return json;
  };

  let posts = 0;
  let interactions = 0;

  const user = await tw(
    `/users/${encodeURIComponent(userId)}?user.fields=public_metrics,username,name`,
  );
  const stats: Record<string, number> = {
    followers: Number(user.data?.public_metrics?.followers_count ?? 0),
    following: Number(user.data?.public_metrics?.following_count ?? 0),
    tweets: Number(user.data?.public_metrics?.tweet_count ?? 0),
  };

  const tweets = await tw(
    `/users/${encodeURIComponent(userId)}/tweets?max_results=10&tweet.fields=created_at,public_metrics`,
  );
  for (const t of tweets.data ?? []) {
    if (
      await savePost(account, {
        external_id: t.id,
        caption: t.text ?? "(post)",
        published_at: t.created_at,
        likes: t.public_metrics?.like_count ?? 0,
        comments_count: t.public_metrics?.reply_count ?? 0,
        shares: t.public_metrics?.retweet_count ?? 0,
        reach: t.public_metrics?.impression_count ?? 0,
      })
    )
      posts++;
  }

  try {
    const mentions = await tw(
      `/users/${encodeURIComponent(userId)}/mentions?max_results=20&tweet.fields=created_at,author_id&expansions=author_id&user.fields=username,name`,
    );
    const authors = new Map<string, { name?: string; username?: string }>(
      (mentions.includes?.users ?? []).map((u: any) => [u.id, u]),
    );
    for (const m of mentions.data ?? []) {
      const author = m.author_id ? authors.get(m.author_id) : undefined;
      if (
        await saveInteraction(account, {
          external_id: m.id,
          kind: "comment",
          author_name: author?.name ?? "X user",
          author_handle: author?.username ?? null,
          body: m.text ?? "",
          created_at: m.created_at,
        })
      )
        interactions++;
    }
  } catch {
    // Mentions need a paid access tier — posts and stats still synced.
  }

  await finishSync(account.id, stats);
  return { ok: true, posts, interactions };
}

/* ---------- LinkedIn (Organization page — OAuth token + org ID) ---------- */

async function syncLinkedIn(account: SocialAccountSecret): Promise<SyncResult> {
  const token = account.access_token?.trim();
  const orgId = account.external_id?.trim();
  if (!token || !orgId) {
    return missingCreds("Add your LinkedIn organization ID and an OAuth access token first.");
  }
  const li = async (url: string): Promise<any> => {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "LinkedIn-Version": LINKEDIN_API_VERSION,
        "X-Restli-Protocol-Version": "2.0.0",
      },
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        `LinkedIn API returned HTTP ${res.status} (${json?.message ?? "token may be missing w_organization_social / rw_organization_admin scopes"})`,
      );
    }
    return json;
  };

  let posts = 0;
  const urn = `urn:li:organization:${orgId}`;

  let stats: Record<string, number> | undefined;
  try {
    const followers = await li(
      `https://api.linkedin.com/rest/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(urn)}`,
    );
    const el = followers.elements?.[0];
    const count = el?.followerCounts?.organicFollowerCount ?? el?.followerCounts?.paidFollowerCount;
    if (typeof count === "number") stats = { followers: count };
  } catch {
    // Follower stats need Marketing Developer Platform access — continue with posts.
  }

  const feed = await li(
    `https://api.linkedin.com/rest/posts?author=${encodeURIComponent(urn)}&q=author&count=10&sortBy=LAST_MODIFIED`,
  );
  for (const p of feed.elements ?? []) {
    // A missing id used to fall back to a fresh random UUID every sync,
    // which meant the same post (if LinkedIn ever omitted its id) never
    // matched itself on the next run and got re-inserted as a duplicate.
    // Skipping it is safer than fabricating an identity for it.
    if (!p.id) continue;
    if (
      await savePost(account, {
        external_id: String(p.id),
        caption: p.commentary ?? "(LinkedIn post)",
        published_at: p.publishedAt ? new Date(p.publishedAt).toISOString() : null,
      })
    )
      posts++;
  }

  await finishSync(account.id, stats);
  return { ok: true, posts, interactions: 0 };
}

/* ---------- TikTok (Business account — OAuth token) ---------- */

async function syncTikTok(account: SocialAccountSecret): Promise<SyncResult> {
  const token = account.access_token?.trim();
  if (!token) {
    return missingCreds("Add a TikTok access token first (TikTok for Developers → your app).");
  }
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  let stats: Record<string, number> | undefined;
  try {
    const res = await fetch(
      "https://open.tiktokapis.com/v2/user/info/?fields=follower_count,likes_count,video_count",
      { headers },
    );
    const json: any = await res.json().catch(() => ({}));
    const u = json?.data?.user;
    if (u) {
      stats = {
        followers: Number(u.follower_count ?? 0),
        totalLikes: Number(u.likes_count ?? 0),
        videos: Number(u.video_count ?? 0),
      };
    }
  } catch {
    // user.info.basic scope missing — continue with videos.
  }

  const res = await fetch(
    "https://open.tiktokapis.com/v2/video/list/?fields=id,title,create_time,like_count,comment_count,share_count,view_count",
    { method: "POST", headers, body: JSON.stringify({ max_count: 10 }) },
  );
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.error?.code !== "ok") {
    throw new Error(
      `TikTok API error (${json?.error?.message ?? `HTTP ${res.status}`}) — the token needs the video.list scope.`,
    );
  }

  let posts = 0;
  for (const v of json?.data?.videos ?? []) {
    if (
      await savePost(account, {
        external_id: v.id,
        caption: v.title ?? "(TikTok video)",
        published_at: v.create_time ? new Date(v.create_time * 1000).toISOString() : null,
        likes: v.like_count ?? 0,
        comments_count: v.comment_count ?? 0,
        shares: v.share_count ?? 0,
        reach: v.view_count ?? 0,
      })
    )
      posts++;
  }

  await finishSync(account.id, stats);
  return { ok: true, posts, interactions: 0 };
}

/* ---------- Google Business Profile (OAuth token + accounts/…/locations/…) ---------- */

async function syncGoogleBusiness(account: SocialAccountSecret): Promise<SyncResult> {
  const token = account.access_token?.trim();
  const location = account.external_id?.trim();
  if (!token || !location) {
    return missingCreds(
      "Add the location path (accounts/123/locations/456) and a Google OAuth token first.",
    );
  }
  // Reviews are served by the v4 Google My Business API:
  // GET mybusiness.googleapis.com/v4/{accounts/*/locations/*}/reviews. An
  // earlier change moved this to "mybusinessreviews.googleapis.com/v1" on the
  // belief that v4 was being retired. That host does not exist -- it answers
  // 404 and Google's API directory lists no such API -- so every review sync
  // failed. The v4 reviews method is current and not marked deprecated.
  const res = await fetch(
    `https://mybusiness.googleapis.com/v4/${location.replace(/^\/+|\/+$/g, "")}/reviews?pageSize=50`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Google Business API returned HTTP ${res.status} (${json?.error?.message ?? "check the OAuth token and location path"})`,
    );
  }

  let interactions = 0;
  for (const r of json.reviews ?? []) {
    const stars = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }[r.starRating as string] ?? null;
    if (
      await saveInteraction(account, {
        external_id: r.reviewId ?? r.name ?? crypto.randomUUID(),
        kind: "comment",
        author_name: r.reviewer?.displayName ?? "Google reviewer",
        body: `${stars ? `${"★".repeat(stars)}${"☆".repeat(5 - stars)} — ` : ""}${r.comment ?? "(rating only, no text)"}`,
        created_at: r.createTime,
      })
    )
      interactions++;
  }

  const stats: Record<string, number> = {
    reviews: Number(json.totalReviewCount ?? json.reviews?.length ?? 0),
    averageRating: Math.round(Number(json.averageRating ?? 0) * 10) / 10,
  };

  await finishSync(account.id, stats);
  return { ok: true, posts: 0, interactions };
}

/* ---------- entry point ---------- */

/** Pulls recent posts, comments/DMs/reviews and audience stats for one account. */
export async function syncSocialAccount(
  stored: SocialAccountSecret,
  /**
   * True when this account has never synced. Its whole history arrives at once,
   * and filing two years of it as "Open" told the team they had dozens of
   * conversations to answer.
   */
  firstSync = false,
): Promise<SyncResult> {
  try {
    // Opened here as well as by the callers, so one that passes the stored
    // column straight through cannot hand a provider ciphertext. Plaintext is
    // returned unchanged, so opening twice is harmless.
    const account = { ...stored, access_token: await openSecret(stored.access_token) };
    switch (account.platform) {
      case "instagram":
      case "facebook":
        return await syncMeta(account, firstSync);
      case "youtube":
        return await syncYouTube(account);
      case "twitter":
        return await syncTwitter(account);
      case "linkedin":
        return await syncLinkedIn(account);
      case "tiktok":
        return await syncTikTok(account);
      case "google_business":
        return await syncGoogleBusiness(account);
      default:
        // Every connector reaches this from the same Sync button. Falling off
        // the switch returned undefined, which the caller then read `.ok`
        // from and crashed with a TypeError.
        return {
          ok: false,
          posts: 0,
          interactions: 0,
          error:
            "Flas does not sync this platform yet. The connection is saved, but nothing is pulled from it.",
        };
    }
  } catch (e) {
    return {
      ok: false,
      posts: 0,
      interactions: 0,
      error: e instanceof Error ? e.message : "Sync failed",
    };
  }
}

/** Posts a reply to a Facebook/Instagram comment. Returns true when Meta accepts it. */
export async function replyToComment(
  platform: "facebook" | "instagram",
  commentExternalId: string,
  message: string,
  token: string,
): Promise<boolean> {
  try {
    // Opened here too: a caller passing the stored column must not send Meta
    // ciphertext. Plaintext passes through unchanged.
    token = (await openSecret(token)) ?? "";
    // Facebook and Instagram reply on different edges: /{comment}/comments
    // for a Facebook comment, /{comment}/replies for an Instagram one. Every
    // Facebook reply was sent to /replies, which is Instagram's, so none was
    // ever delivered.
    const edge = platform === "facebook" ? "comments" : "replies";
    const res = await fetch(`${GRAPH}/${commentExternalId}/${edge}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message }),
    });
    const json: any = await res.json().catch(() => ({}));
    return Boolean(res.ok && !json?.error);
  } catch {
    return false;
  }
}

/** Flas AI drafts a customer-support reply to a comment or DM. */
export async function draftSocialReply(
  supabase: RlsClient,
  input: { kind: string; author: string; body: string },
): Promise<string> {
  const business = await getBusinessContext(supabase);
  const system = [
    "You are Flas AI, an expert social media customer-support agent inside Flas CRM.",
    "Write a short public reply to a social media comment, review or DM on behalf of the business.",
    "Rules: warm and human, under 280 characters, answer the question directly when you can,",
    "never invent prices, policies or discounts, move anything personal (orders, phone numbers)",
    "to a private channel by inviting them to DM or WhatsApp, and match the business's tone.",
    "Output ONLY the reply text.",
  ].join("\n");
  const user = [
    `Business: ${business?.business_name ?? "unknown"} (${business?.industry ?? "general"})`,
    business?.description ? `About: ${business.description}` : "",
    business?.learned_facts ? `Known facts: ${business.learned_facts}` : "",
    `${input.kind === "dm" ? "DM" : "Comment/review"} from ${input.author}:`,
    input.body,
  ]
    .filter(Boolean)
    .join("\n");
  return callFlashAi(system, user, await aiOptionsFor(supabase, "social_reply"));
}

/** Flas AI writes a ready-to-post caption for any connected social platform. */
export async function composeSocialCaption(
  supabase: RlsClient,
  input: { topic: string; tone: string; platform: string },
): Promise<string> {
  const business = await getBusinessContext(supabase);
  const system = [
    "You are Flas AI, an expert social media content writer inside Flas CRM.",
    "Write a ready-to-publish post for the requested platform, respecting its culture and length norms",
    "(e.g. very short for X, professional for LinkedIn, hook-first captions for Instagram/TikTok).",
    "Rules: strong hook in the first line, short punchy paragraphs, one clear call to action,",
    "3-5 relevant hashtags where the platform uses them, at most 2 emojis,",
    "no misleading claims. Output ONLY the post text.",
  ].join("\n");
  const user = [
    `Business: ${business?.business_name ?? "unknown"} (${business?.industry ?? "general"})`,
    business?.description ? `About: ${business.description}` : "",
    business?.learned_facts ? `Known facts: ${business.learned_facts}` : "",
    `Platform: ${input.platform}. Tone: ${input.tone}.`,
    `Post topic or goal: ${input.topic}`,
  ]
    .filter(Boolean)
    .join("\n");
  return callFlashAi(system, user, await aiOptionsFor(supabase, "social_caption"));
}
