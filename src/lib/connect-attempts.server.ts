/*
 * Reading how one authorization attempt ended, and saying it in English.
 *
 * The waiting tab cannot be told "you are connected" by anything the browser
 * can forge, so this is where the question is actually answered: one row of
 * oauth_states, read with the service role, and refused unless it belongs both
 * to the caller's workspace AND to the caller. Tenant scoping alone would let
 * one colleague resolve another's in-flight attempt by guessing a uuid.
 *
 * Nothing that leaves this module can be a credential. The row's only
 * sensitive columns are code_verifier and state_hash, and neither is selected.
 */
import {
  type Audience,
  type ConnectAttempt,
  type ConnectAttemptPhase,
  type ConnectionProblem,
  forAudience,
} from "@/lib/connection-problem";
import { connector } from "@/lib/connections-catalog";
import { PROVIDER_SETUP } from "@/lib/provider-setup-links";
import { decodeAttemptReason } from "@/lib/oauth-return";
import { effectiveAttemptState } from "@/lib/connection-state";

/** Exactly the columns the lookup needs. code_verifier is never among them. */
export type AttemptRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  platform: string;
  attempt_state: string;
  attempt_reason: string | null;
  expires_at: string;
  used_at: string | null;
  created_at: string;
};

export const ATTEMPT_COLUMNS =
  "id, tenant_id, user_id, platform, attempt_state, attempt_reason, expires_at, used_at, created_at";

/** Injected in tests; in production it is the service-role read below. */
export type AttemptLoader = (attemptId: string) => Promise<AttemptRow | null>;

async function loadAttemptRow(attemptId: string): Promise<AttemptRow | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("oauth_states")
    .select(ATTEMPT_COLUMNS)
    .eq("id", attemptId)
    .maybeSingle();
  if (error || !data) return null;
  return data as AttemptRow;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Failure codes, as something a customer can act on
 * ═══════════════════════════════════════════════════════════════════════════ */

type ProblemContext = {
  platform: string;
  /** The exact callback address registered with the provider. Never secret. */
  redirectUri?: string | null | undefined;
  /** The sentence the callback recorded, once its markers are stripped. */
  detail?: string | null | undefined;
};

function providerFor(platform: string) {
  return connector(platform)?.provider ?? null;
}

function providerName(platform: string): string {
  const provider = providerFor(platform);
  if (provider) return PROVIDER_SETUP[provider].displayName;
  return connector(platform)?.name ?? platform.replace(/_/g, " ");
}

/** The provider's own console page for whichever thing has to be fixed. */
function setupLink(
  platform: string,
  wanted: "apps" | "credentials" | "permissions" | "review" | "docs" | "api",
): { url: string; urlLabel: string } | null {
  const provider = providerFor(platform);
  if (!provider) return null;
  const info = PROVIDER_SETUP[provider];
  const link = info.links.find((l) => l.id === wanted) ?? info.links[0];
  if (!link) return null;
  return { url: link.url, urlLabel: link.label };
}

/**
 * One ConnectionProblem per failure the callback can record.
 *
 * The copy rule from the shared contract holds throughout: a title a person
 * would say out loud, a message that says what happened, and a nextAction that
 * is an instruction. Setting names and HTTP statuses live in `technical`, which
 * forAudience() strips for anyone who cannot act on them.
 */
export function connectAttemptProblem(
  code: string | null,
  context: ProblemContext,
): ConnectionProblem | null {
  if (!code) return null;
  const name = providerName(context.platform);
  const channel = connector(context.platform)?.name ?? context.platform.replace(/_/g, " ");
  const detail = context.detail?.trim() || undefined;

  switch (code) {
    case "platform_app_missing":
      return {
        code: "OAUTH_APP_KEYS_MISSING",
        title: `Flas has no ${name} app keys for this workspace`,
        message: `${channel} can only be connected once this workspace's ${name} App ID and secret are saved in Flas.`,
        owner: "WORKSPACE_ADMIN",
        severity: "blocking",
        nextAction: `Open Connect & setup, choose ${channel}, and paste the ${name} App ID and secret.`,
        userMessage: `${channel} is not ready to connect yet — an administrator still has to add this workspace's ${name} app keys.`,
        retryable: false,
        ...(setupLink(context.platform, "apps") ?? {}),
        technical: { detail: detail ?? "startAuthorization found no client id or secret" },
      };

    case "redirect_uri_mismatch":
      return {
        code: "OAUTH_REDIRECT_URI_MISMATCH",
        title: `${name} does not recognise this Flas callback address`,
        message: `${name} refused the sign-in because the address Flas asked it to return to is not one of the addresses registered on the ${name} app.`,
        owner: "WORKSPACE_ADMIN",
        severity: "blocking",
        nextAction: `Open the ${name} app settings, add the callback address below to its list of valid redirect URIs exactly as shown, save, then press Connect again.`,
        userMessage: `${channel} cannot be connected until an administrator registers Flas's return address with ${name}.`,
        retryable: false,
        ...(context.redirectUri
          ? { copyValue: context.redirectUri, copyLabel: "Callback address to register" }
          : {}),
        ...(setupLink(context.platform, "apps") ?? {}),
        technical: {
          detail: detail ?? `Provider rejected redirect_uri ${context.redirectUri ?? ""}`,
        },
      };

    case "token_exchange_failed":
      return {
        code: "OAUTH_TOKEN_EXCHANGE_FAILED",
        title: `${name} would not complete the sign-in`,
        message: `${name} accepted the login but refused to issue an access token for it. That is almost always the app's secret being wrong, or the app still being in development mode.`,
        owner: "WORKSPACE_ADMIN",
        severity: "blocking",
        nextAction: `Check the ${name} app's secret in Connect & setup, confirm the app is live rather than in development, then press Connect again.`,
        userMessage: `${channel} could not be connected because ${name} refused the request. An administrator needs to check the app's settings.`,
        retryable: true,
        ...(setupLink(context.platform, "apps") ?? {}),
        technical: { detail: detail ?? "Token endpoint refused the authorization code" },
      };

    case "pkce_error":
      return {
        code: "OAUTH_PKCE_FAILED",
        title: "The security check on this sign-in did not match",
        message: `The one-time proof Flas generated when you pressed Connect did not match the one ${name} returned. This usually means the sign-in was finished in a different browser, or it was left open too long.`,
        owner: "END_USER",
        severity: "blocking",
        nextAction: "Press Connect again and finish the sign-in in the window that opens.",
        retryable: true,
        technical: { detail: detail ?? "code_verifier did not satisfy the code_challenge" },
      };

    case "state_expired":
    case "grant_expired":
      return {
        code: "OAUTH_ATTEMPT_EXPIRED",
        title: "This sign-in took too long and expired",
        message: `Flas holds a connection request open for about fifteen minutes. This one was not finished in time, so ${name} sent back an answer Flas can no longer match to your click.`,
        owner: "END_USER",
        severity: "warning",
        nextAction: "Press Connect again — nothing was saved, so there is nothing to clean up.",
        retryable: true,
      };

    case "state_invalid":
      return {
        code: "OAUTH_STATE_INVALID",
        title: "Flas could not match that sign-in to a Connect click",
        message:
          "The answer from the provider did not carry a request Flas recognises. That happens when a link is reused, opened twice, or arrives from somewhere other than the window Flas opened.",
        owner: "END_USER",
        severity: "warning",
        nextAction: "Press Connect again and finish the sign-in in the window that opens.",
        retryable: true,
      };

    case "access_denied":
      return {
        code: "OAUTH_ACCESS_DENIED",
        title: `The ${name} sign-in was cancelled`,
        message: `Nothing was connected. Either Cancel was pressed on the ${name} screen, or ${name} declined the request.`,
        owner: "END_USER",
        severity: "info",
        nextAction: `Press Connect again, and choose Continue on the ${name} screen to finish.`,
        retryable: true,
      };

    case "scope_rejected":
      return {
        code: "OAUTH_SCOPE_REJECTED",
        title: "Some permissions were not granted",
        message: `${name} completed the sign-in without every permission ${channel} needs, so parts of Flas would not work with this connection.`,
        owner: "END_USER",
        severity: "warning",
        nextAction:
          "Press Connect again and leave every permission switched on when the provider asks.",
        retryable: true,
        ...(setupLink(context.platform, "permissions") ?? {}),
        ...(detail ? { technical: { detail } } : {}),
      };

    case "no_eligible_target":
      return {
        code: "OAUTH_NO_ELIGIBLE_TARGET",
        title: `That ${name} login does not manage anything Flas can connect`,
        message:
          detail ??
          `The sign-in worked, but the account you used does not administer a ${channel} Flas can read or post to.`,
        owner: "END_USER",
        severity: "blocking",
        nextAction: `Sign in again with an account that administers the ${channel} you want to connect, or ask its owner to give you admin access first.`,
        retryable: true,
        ...(setupLink(context.platform, "permissions") ?? {}),
      };

    case "multiple_targets":
      return {
        code: "OAUTH_TARGET_CHOICE_REQUIRED",
        title: "Choose which account Flas should manage",
        message: `That login manages more than one ${channel}. Flas will not guess which one this workspace means.`,
        owner: "END_USER",
        severity: "info",
        nextAction: "Pick the account Flas should read and post to.",
        retryable: false,
      };

    case "connect_failed":
    default:
      return {
        code: "OAUTH_CONNECT_FAILED",
        title: `${channel} could not be connected`,
        message:
          detail ??
          `${name} returned an answer Flas could not complete. Nothing was saved, so there is no half-connected account.`,
        owner: "END_USER",
        severity: "blocking",
        nextAction: "Press Connect again. If it fails a second time, contact support.",
        retryable: true,
        ...(detail ? { technical: { detail } } : {}),
      };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * The lookup
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Maps the stored attempt state, plus the markers on attempt_reason, to the
 * phase the waiting screen understands.
 *
 * `completed` splits in two: an attempt that saved a connection outright is
 * done, while one that saved a pending row and stopped for the customer to
 * choose a Page still needs them. Both are written as "completed" by the
 * callback, because as far as the authorization is concerned they are.
 */
function attemptPhase(row: AttemptRow, targetAccountId: string | null): ConnectAttemptPhase {
  const state = effectiveAttemptState({
    attempt_state: row.attempt_state,
    used_at: row.used_at,
    expires_at: row.expires_at,
  });
  switch (state) {
    case "completed":
      return targetAccountId ? "needs_target" : "completed";
    case "cancelled":
      return "cancelled";
    case "callback_error":
      return "failed";
    case "expired":
      return "expired";
    case "started":
    case "callback_received":
    default:
      return "pending";
  }
}

/**
 * One attempt, as the caller is allowed to see it.
 *
 * Returns null for anything the caller may not have -- a row in another
 * workspace, another person's attempt, or an id that does not exist. All three
 * are deliberately indistinguishable from outside: a caller who can tell "not
 * yours" from "no such row" can enumerate other people's activity.
 */
export async function readConnectAttempt(args: {
  attemptId: string;
  tenantId: string | null;
  userId: string;
  audience: Audience;
  /** The registered callback address, for a redirect-mismatch problem. */
  redirectUri?: string | null | undefined;
  load?: AttemptLoader | undefined;
}): Promise<ConnectAttempt | null> {
  if (!args.tenantId) return null;
  const load = args.load ?? loadAttemptRow;
  const row = await load(args.attemptId);
  if (!row) return null;
  // Both checks, always. The service role read above bypassed RLS entirely, so
  // this pair is the only thing standing between a uuid and someone else's
  // connection attempt.
  if (row.tenant_id !== args.tenantId) return null;
  if (row.user_id !== args.userId) return null;

  const markers = decodeAttemptReason(row.attempt_reason);
  const phase = attemptPhase(row, markers.targetAccountId);

  let problem: ConnectionProblem | null = null;
  if (phase === "failed" || phase === "cancelled" || phase === "expired") {
    const code =
      markers.code ??
      (phase === "cancelled" ? "access_denied" : phase === "expired" ? "state_expired" : null);
    problem = connectAttemptProblem(code, {
      platform: row.platform,
      ...(args.redirectUri ? { redirectUri: args.redirectUri } : {}),
      ...(markers.reason ? { detail: markers.reason } : {}),
    });
  } else if (phase === "needs_target") {
    problem = connectAttemptProblem("multiple_targets", { platform: row.platform });
  }

  return {
    attemptId: row.id,
    platform: row.platform,
    phase,
    accountId: markers.targetAccountId ?? markers.accountId,
    problem: problem ? forAudience(problem, args.audience) : null,
    // oauth_states carries no updated_at; used_at is when the callback ran,
    // which is the only moment the row's outcome can have changed.
    updatedAt: row.used_at ?? row.created_at,
  };
}
