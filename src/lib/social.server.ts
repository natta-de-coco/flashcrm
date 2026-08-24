// Server-only helpers for the Social Hub: Meta Graph syncing, AI reply
// drafting and AI content composing. Tenant data flows through the caller's
// RLS-scoped client; only social account tokens are read via the admin client.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { callFlashAi, getBusinessContext } from "./flash-ai.server";

type RlsClient = {
  from: (table: string) => never;
};

export type SocialAccountSecret = {
  id: string;
  tenant_id: string;
  platform: "instagram" | "facebook";
  external_id: string | null;
  access_token: string | null;
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

export type SyncResult = { ok: boolean; posts: number; interactions: number; error?: string };

/** Pulls recent posts, comments and (permission permitting) DMs from Meta. */
export async function syncSocialAccount(account: SocialAccountSecret): Promise<SyncResult> {
  if (!account.access_token || !account.external_id) {
    return {
      ok: false,
      posts: 0,
      interactions: 0,
      error: "Add the Meta account ID and access token first.",
    };
  }
  const token = account.access_token;
  let posts = 0;
  let interactions = 0;

  try {
    if (account.platform === "instagram") {
      const media = await graphGet(
        `/${account.external_id}/media?fields=id,caption,like_count,comments_count,timestamp&limit=20`,
        token,
      );
      for (const m of media.data ?? []) {
        const { error } = await supabaseAdmin.from("social_posts").upsert(
          {
            tenant_id: account.tenant_id,
            account_id: account.id,
            external_id: m.id,
            caption: m.caption ?? "(media post)",
            status: "published",
            published_at: m.timestamp ?? null,
            likes: m.like_count ?? 0,
            comments_count: m.comments_count ?? 0,
          },
          { onConflict: "account_id,external_id" },
        );
        if (!error) posts++;

        try {
          const comments = await graphGet(
            `/${m.id}/comments?fields=id,username,text,timestamp&limit=50`,
            token,
          );
          for (const c of comments.data ?? []) {
            const { error: cErr } = await supabaseAdmin.from("social_interactions").upsert(
              {
                tenant_id: account.tenant_id,
                account_id: account.id,
                kind: "comment",
                direction: "in",
                author_name: c.username ?? "Instagram user",
                author_handle: c.username ?? null,
                body: c.text ?? "",
                external_id: c.id,
                created_at: c.timestamp ?? new Date().toISOString(),
              },
              { onConflict: "account_id,external_id" },
            );
            if (!cErr) interactions++;
          }
        } catch {
          // Token lacks instagram_manage_comments — skip comments for this media.
        }
      }
    } else {
      const feed = await graphGet(
        `/${account.external_id}/feed?fields=id,message,created_time,likes.summary(true),comments.limit(20){id,from,message,created_time}&limit=20`,
        token,
      );
      for (const p of feed.data ?? []) {
        const { error } = await supabaseAdmin.from("social_posts").upsert(
          {
            tenant_id: account.tenant_id,
            account_id: account.id,
            external_id: p.id,
            caption: p.message ?? "(page post)",
            status: "published",
            published_at: p.created_time ?? null,
            likes: p.likes?.summary?.total_count ?? 0,
            comments_count: p.comments?.summary?.total_count ?? 0,
          },
          { onConflict: "account_id,external_id" },
        );
        if (!error) posts++;

        for (const c of p.comments?.data ?? []) {
          if (c.from?.id === account.external_id) continue;
          const { error: cErr } = await supabaseAdmin.from("social_interactions").upsert(
            {
              tenant_id: account.tenant_id,
              account_id: account.id,
              kind: "comment",
              direction: "in",
              author_name: c.from?.name ?? "Facebook user",
              author_handle: null,
              body: c.message ?? "",
              external_id: c.id,
              created_at: c.created_time ?? new Date().toISOString(),
            },
            { onConflict: "account_id,external_id" },
          );
          if (!cErr) interactions++;
        }
      }

      // Messenger DMs — requires pages_messaging permission; best-effort.
      try {
        const convs = await graphGet(
          `/${account.external_id}/conversations?fields=messages.limit(10){id,message,from,created_time}&limit=10`,
          token,
        );
        for (const conv of convs.data ?? []) {
          for (const msg of conv.messages?.data ?? []) {
            if (msg.from?.id === account.external_id) continue; // our own replies
            const { error: mErr } = await supabaseAdmin.from("social_interactions").upsert(
              {
                tenant_id: account.tenant_id,
                account_id: account.id,
                kind: "dm",
                direction: "in",
                author_name: msg.from?.name ?? "Messenger user",
                author_handle: null,
                body: msg.message ?? "",
                external_id: msg.id,
                created_at: msg.created_time ?? new Date().toISOString(),
              },
              { onConflict: "account_id,external_id" },
            );
            if (!mErr) interactions++;
          }
        }
      } catch {
        // Messaging permission missing — comments/posts still synced.
      }
    }

    await supabaseAdmin
      .from("social_accounts")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("id", account.id);

    return { ok: true, posts, interactions };
  } catch (e) {
    return {
      ok: false,
      posts,
      interactions,
      error: e instanceof Error ? e.message : "Sync failed",
    };
  }
}

/** Posts a reply to a Facebook/Instagram comment. Returns true when Meta accepts it. */
export async function replyToComment(
  commentExternalId: string,
  message: string,
  token: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${GRAPH}/${commentExternalId}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, access_token: token }),
    });
    const json: any = await res.json().catch(() => ({}));
    return Boolean(res.ok && !json?.error);
  } catch {
    return false;
  }
}

/** Flash AI drafts a customer-support reply to a comment or DM. */
export async function draftSocialReply(
  supabase: RlsClient,
  input: { kind: string; author: string; body: string },
): Promise<string> {
  const business = await getBusinessContext(supabase);
  const system = [
    "You are Flash AI, an expert social media customer-support agent inside Flash CRM.",
    "Write a short public reply to a social media comment or DM on behalf of the business.",
    "Rules: warm and human, under 280 characters, answer the question directly when you can,",
    "never invent prices, policies or discounts, move anything personal (orders, phone numbers)",
    "to a private channel by inviting them to DM or WhatsApp, and match the business's tone.",
    "Output ONLY the reply text.",
  ].join("\n");
  const user = [
    `Business: ${business?.business_name ?? "unknown"} (${business?.industry ?? "general"})`,
    business?.description ? `About: ${business.description}` : "",
    business?.learned_facts ? `Known facts: ${business.learned_facts}` : "",
    `${input.kind === "dm" ? "DM" : "Comment"} from ${input.author}:`,
    input.body,
  ]
    .filter(Boolean)
    .join("\n");
  return callFlashAi(system, user);
}

/** Flash AI writes a ready-to-post caption for Instagram/Facebook. */
export async function composeSocialCaption(
  supabase: RlsClient,
  input: { topic: string; tone: string; platform: string },
): Promise<string> {
  const business = await getBusinessContext(supabase);
  const system = [
    "You are Flash AI, an expert social media content writer inside Flash CRM.",
    "Write a ready-to-publish caption for the requested platform.",
    "Rules: strong hook in the first line, short punchy paragraphs, one clear call to action,",
    "3-5 relevant hashtags at the end, at most 2 emojis, under 2200 characters,",
    "no misleading claims. Output ONLY the caption.",
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
  return callFlashAi(system, user);
}
