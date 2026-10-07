import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { ConnectSchema, PLATFORMS } from "@/lib/social-schema";
import { z } from "zod";

const IdSchema = z.object({ id: z.string().uuid() });

const ReplySchema = z.object({ id: z.string().uuid(), reply: z.string().min(1).max(2000) });

const StatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["open", "replied", "archived"]),
});

const ComposeSchema = z.object({
  topic: z.string().min(3).max(500),
  tone: z.enum(["friendly", "professional", "bold", "playful"]).default("friendly"),
  platform: z.enum(PLATFORMS).default("instagram"),
});

const SavePostSchema = z.object({
  caption: z.string().min(1).max(4000),
  platform: z.enum(PLATFORMS),
  /**
   * Which account the post is for. A uuid is that account; null is "No
   * account", which the screen offers and which must be kept; leaving it out
   * (a screen loaded before null was sent) lets the server pick the platform's
   * first active account, as it always did.
   */
  accountId: z.string().uuid().nullable().optional(),
  scheduledAt: z.string().datetime().optional(),
});

/** Everything the Social Hub page needs in one round trip. */
export const getSocialHub = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = context.supabase;
    const [accounts, interactions, posts] = await Promise.all([
      supabase
        .from("social_accounts")
        .select(
          "id, tenant_id, platform, label, external_id, connect_method, active, last_synced_at, created_at, stats",
        )
        .order("created_at", { ascending: true }),
      supabase
        .from("social_interactions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("social_posts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    if (accounts.error) throw accounts.error;
    if (interactions.error) throw interactions.error;
    if (posts.error) throw posts.error;
    return { accounts: accounts.data, interactions: interactions.data, posts: posts.data };
  });

/** Connect an Instagram professional account or Facebook Page (admin only via RLS). */
export const connectSocialAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ConnectSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { sealSecret } = await import("@/lib/secret-box.server");
    const { error } = await context.supabase.from("social_accounts").insert({
      platform: data.platform,
      label: data.label.trim(),
      external_id: data.externalId?.trim() || null,
      access_token: await sealSecret(data.accessToken?.trim() || null),
    });
    if (error) throw error;

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "social.account_connected",
      actorId: context.userId,
      entityType: "social_account",
      details: { platform: data.platform, label: data.label },
    });
    return { ok: true };
  });

export const deleteSocialAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => IdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("social_accounts").delete().eq("id", data.id);
    if (error) throw error;

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "social.account_deleted",
      actorId: context.userId,
      entityType: "social_account",
      entityId: data.id,
    });
    return { ok: true };
  });

/** Syncs posts, comments and DMs from Meta for one connected account. */
export const syncSocialAccountFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => IdSchema.parse(input))
  .handler(async ({ data, context }) => {
    // Tenant membership is proven by reading the account through RLS first.
    const { data: account, error } = await context.supabase
      .from("social_accounts")
      .select("id, tenant_id, platform, external_id, connect_method, last_synced_at")
      .eq("id", data.id)
      .single();
    if (error || !account) throw new Error("Account not found");
    type SocialPlatform = import("@/lib/social.server").SocialPlatform;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { openSecret } = await import("@/lib/secret-box.server");
    const readSecret = async () => {
      const { data: stored } = await supabaseAdmin
        .from("social_accounts")
        .select("access_token, refresh_token, token_expires_at")
        .eq("id", account.id)
        .eq("tenant_id", account.tenant_id)
        .single();
      return stored ? { ...stored, access_token: await openSecret(stored.access_token) } : stored;
    };
    let secret = await readSecret();

    // Google access tokens last an hour and X ones two. Sync never renewed
    // them, so a connection worked for an hour and then failed until someone
    // pressed Retry. Renew first when the token has expired or is about to.
    const expiresAt = secret?.token_expires_at ? new Date(secret.token_expires_at).getTime() : null;
    if (secret?.refresh_token && expiresAt !== null && expiresAt - Date.now() < 2 * 60_000) {
      const { retryConnection } = await import("@/lib/integration-health.server");
      await retryConnection({
        accountId: account.id,
        tenantId: account.tenant_id,
        trigger: "auto",
        actorId: context.userId,
      });
      secret = await readSecret();
    }

    const { syncSocialAccount } = await import("@/lib/social.server");
    // A first sync brings the whole history at once. Filing two years of it as
    // "Open" reported dozens of conversations waiting for a reply that nobody
    // was ever going to send.
    const result = await syncSocialAccount(
      {
        id: account.id,
        tenant_id: account.tenant_id,
        platform: account.platform as SocialPlatform,
        external_id: account.external_id,
        access_token: secret?.access_token ?? null,
        connect_method: account.connect_method ?? null,
      },
      !account.last_synced_at,
    );

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "social.account_synced",
      actorId: context.userId,
      entityType: "social_account",
      entityId: account.id,
      details: { ok: result.ok, posts: result.posts, interactions: result.interactions },
    });
    return result;
  });

/** Flas AI drafts a reply; saved on the interaction for review. */
export const suggestSocialReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => IdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("social_interactions")
      .select("*")
      .eq("id", data.id)
      .single();
    if (error || !row) throw new Error("Interaction not found");

    const { draftSocialReply } = await import("@/lib/social.server");
    const suggestion = await draftSocialReply(context.supabase as never, {
      kind: row.kind,
      author: row.author_name ?? "there",
      body: row.body,
    });

    await context.supabase
      .from("social_interactions")
      .update({ ai_suggestion: suggestion })
      .eq("id", row.id);

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "social.ai_reply_drafted",
      actorId: context.userId,
      entityType: "social_interaction",
      entityId: row.id,
    });
    return { suggestion };
  });

/** Records the reply, keeps an outbound copy, and posts it to Meta when possible. */
export const sendSocialReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ReplySchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("social_interactions")
      .select("*")
      .eq("id", data.id)
      .single();
    if (error || !row) throw new Error("Interaction not found");

    let metaDelivered = false;
    if (row.kind === "comment" && row.external_id) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: secret } = await supabaseAdmin
        .from("social_accounts")
        .select("access_token, platform")
        .eq("id", row.account_id)
        .eq("tenant_id", row.tenant_id)
        .single();
      if (secret) {
        const { openSecret } = await import("@/lib/secret-box.server");
        secret.access_token = await openSecret(secret.access_token);
      }
      const replyPlatform = secret?.platform;
      if (secret?.access_token && (replyPlatform === "facebook" || replyPlatform === "instagram")) {
        const { replyToComment } = await import("@/lib/social.server");
        metaDelivered = await replyToComment(
          replyPlatform,
          row.external_id,
          data.reply,
          secret.access_token,
        );
        // A reply the platform refused must not be recorded as sent. It was
        // marked "replied" regardless, so a customer's comment looked handled
        // while nobody had answered it.
        if (!metaDelivered) {
          throw new Error(
            `${replyPlatform === "facebook" ? "Facebook" : "Instagram"} did not accept the reply, so it was not sent. Check the connection's permissions and try again.`,
          );
        }
      }
    }

    // Only a reply the platform accepted answers the customer. A Messenger
    // reply is saved in FLAS but never sent, so marking the message "replied"
    // told the team it was handled while the customer heard nothing.
    if (metaDelivered) {
      await context.supabase
        .from("social_interactions")
        .update({ status: "replied", replied_at: new Date().toISOString() })
        .eq("id", row.id);
    }
    const { replyMarker } = await import("@/lib/social-thread");
    const { error: saveError } = await context.supabase.from("social_interactions").insert({
      tenant_id: row.tenant_id,
      account_id: row.account_id,
      kind: row.kind,
      direction: "out",
      author_name: "You",
      body: data.reply,
      // Names the message this answers, so it shows in that thread only.
      external_id: replyMarker(row.id, metaDelivered),
    });
    if (saveError) throw new Error(`The reply could not be saved: ${saveError.message}`);

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "social.reply_sent",
      actorId: context.userId,
      entityType: "social_interaction",
      entityId: row.id,
      details: { metaDelivered },
    });
    return { metaDelivered };
  });

export const updateInteractionStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => StatusSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("social_interactions")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

/** Flas AI writes a caption for Instagram/Facebook. */
export const composeSocialPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ComposeSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { composeSocialCaption } = await import("@/lib/social.server");
    const caption = await composeSocialCaption(context.supabase as never, data);

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "social.ai_post_composed",
      actorId: context.userId,
      entityType: "social_post",
      details: { platform: data.platform, tone: data.tone, topic: data.topic.slice(0, 140) },
    });
    return { caption };
  });

/** Saves a drafted caption as a draft or scheduled post. */
export const saveSocialPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SavePostSchema.parse(input))
  .handler(async ({ data, context }) => {
    // null is a choice: the person picked "No account", and the draft is saved
    // with none. Only a request that says nothing about an account gets the
    // platform's first active one — and if that account cannot be looked up,
    // the draft is not saved against a guess of "none".
    let accountId: string | null = data.accountId ?? null;
    if (data.accountId === undefined) {
      const { data: account, error: lookupError } = await context.supabase
        .from("social_accounts")
        .select("id")
        .eq("platform", data.platform)
        .eq("active", true)
        .limit(1)
        .maybeSingle();
      if (lookupError) throw lookupError;
      accountId = account?.id ?? null;
    }

    const { error } = await context.supabase.from("social_posts").insert({
      caption: data.caption,
      account_id: accountId,
      status: data.scheduledAt ? "scheduled" : "draft",
      scheduled_at: data.scheduledAt ?? null,
    });
    if (error) throw error;

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: data.scheduledAt ? "social.post_scheduled" : "social.post_drafted",
      actorId: context.userId,
      entityType: "social_post",
      details: { platform: data.platform },
    });
    return { ok: true };
  });

const UpdatePostSchema = z.object({
  id: z.string().uuid(),
  caption: z.string().min(1).max(4000),
  accountId: z.string().uuid().nullable().optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
});

/**
 * Rewrites a draft or planned post in place.
 *
 * A saved draft used to be unreachable: the composer cleared itself after
 * saving and the only trace was a row in "Reach & audience" with a delete icon
 * (QA, 26 Sep). A published post is read back from the platform and is never
 * edited here — changing the caption in Flas would not change the post, so the
 * update refuses it rather than pretending.
 *
 * Only what the request says is changed. A request with no `scheduledAt` leaves
 * the plan exactly as it is — the stored date and whether the post is planned
 * or a draft — so rewriting a caption cannot quietly turn a planned post back
 * into a draft. The plan is removed by sending `scheduledAt: null`, and moved
 * by sending a new date. Likewise `accountId`: a uuid moves the post to that
 * account, null takes it off its account, and leaving it out keeps it.
 */
export const updateSocialPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdatePostSchema.parse(input))
  .handler(async ({ data, context }) => {
    const changes: {
      caption: string;
      account_id?: string | null;
      scheduled_at?: string | null;
      status?: string;
    } = { caption: data.caption };
    if (data.accountId !== undefined) changes.account_id = data.accountId;
    if (data.scheduledAt !== undefined) {
      changes.scheduled_at = data.scheduledAt;
      changes.status = data.scheduledAt ? "scheduled" : "draft";
    }

    const { data: changed, error } = await context.supabase
      .from("social_posts")
      .update(changes)
      .eq("id", data.id)
      .neq("status", "published")
      .select("id");
    if (error) throw error;
    if (!changed?.[0]) {
      throw new Error(
        "That post could not be edited. A published post is read from the platform and cannot be changed here.",
      );
    }
    return { ok: true };
  });

export const deleteSocialPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => IdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("social_posts").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
