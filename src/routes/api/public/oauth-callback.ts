// Platform OAuth redirect target. The caller is authenticated by the
// single-use, unguessable state row created when the flow started — no session
// is required, and no code is trusted without a matching live state.
import { createFileRoute } from "@tanstack/react-router";
import { capabilityCeiling } from "@/lib/social-connector-definitions";
import { buildCompleteRedirect, type OAuthCompleteParams } from "@/lib/oauth-return";

/**
 * Hands the browser back to Flas, at the popup completion page.
 *
 * Every outcome comes through here, and the query string it produces is
 * allowlisted and scrubbed by buildCompleteRedirect: an attempt id, an outcome
 * word, and plain-English text that has been checked for anything
 * credential-shaped. That matters more here than anywhere else in the flow --
 * this URL is the one that lands in the address bar, the history, and every
 * referer header downstream of it.
 *
 * The origin is the deployment's own, already validated against the allowlist
 * when the authorization started, and the path is a constant, so this cannot
 * become an open redirect.
 */
function complete(origin: string, params: OAuthCompleteParams) {
  return new Response(null, {
    status: 302,
    headers: { Location: `${origin}${buildCompleteRedirect(params)}` },
  });
}

/** Map raw provider/SDK errors to a small set of user-safe codes.  Prevents
 *  tokens, IDs, internal paths from leaking into the browser URL bar / referer
 *  logs (the whole `Location: ...?code=...` shows up there). The code is also
 *  stored on the attempt row, so the waiting tab resolves it to the same
 *  ConnectionProblem the redirect would have described. */
function sanitizeError(raw: unknown): string {
  const msg = raw instanceof Error ? raw.message : String(raw ?? "");
  const low = msg.toLowerCase();
  if (low.includes("credentials are missing")) return "platform_app_missing";
  // Checked before the token-exchange match: a redirect mismatch is reported
  // as a failed exchange by most providers, and it is the one failure with a
  // precise fix -- register this exact address -- so it must not be collapsed
  // into the generic "check your app settings".
  if (low.includes("redirect_uri") || low.includes("redirect uri")) return "redirect_uri_mismatch";
  if (low.includes("token exchange failed")) return "token_exchange_failed";
  if (low.includes("pkce") || low.includes("code_verifier")) return "pkce_error";
  if (low.includes("scope")) return "scope_rejected";
  if (low.includes("expired") || low.includes("invalid_grant")) return "grant_expired";
  return "connect_failed";
}

export const Route = createFileRoute("/api/public/oauth-callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        /**
         * Records how an authorization ended.
         *
         * Only "connection.authorize_started" was ever written, so an attempt
         * that failed left a start with no finish: the log could not
         * distinguish a customer pressing Cancel from an expired state row
         * from a token exchange that errored, and every one of those needs a
         * different reply to the customer.
         */
        const auditOutcome = async (
          outcome: string,
          platform: string | null,
          tenantId: string | null,
          userId: string | null,
          reason: string,
        ) => {
          try {
            const { logAudit } = await import("@/lib/audit.server");
            await logAudit({
              action: `connection.authorize_${outcome}`,
              tenantId,
              actorId: userId,
              entityType: "platform",
              entityId: platform ?? "unknown",
              details: { reason },
            });
          } catch (e) {
            console.error("[oauth-callback] could not audit outcome", e);
          }
        };

        /**
         * Records the attempt's terminal state on its oauth_states row.
         *
         * The audit log says what happened; this makes the row itself say so,
         * which is what the manager portal and the sweep read. Both matter:
         * an attempt whose callback never arrives is only ever resolved by the
         * expiry derivation, and one that does arrive should not still read
         * "started" afterwards.
         */
        /**
         * The attempt row's id, once an outcome has been written to it.
         *
         * This is what the redirect carries and what the waiting tab looks the
         * result up by, so every terminal path records its outcome and keeps
         * the id. It cannot come from consumeState(): the RPC declares a column
         * called `id` but returns `s.state_hash` in that position, so the
         * primary key never reaches this handler by that route.
         */
        let attemptId: string | null = null;

        const markAttemptState = async (
          attemptState: "callback_received" | "cancelled" | "callback_error" | "completed",
          reason: string,
          markers?: {
            /** The connection this attempt saved outright. */
            accountId?: string | null;
            /** Saved, but waiting for the customer to choose which account. */
            targetAccountId?: string | null;
            /** The sanitized failure code, for the problem the tab renders. */
            code?: string | null;
          },
        ) => {
          if (!state) return;
          const { markAttemptOutcome } = await import("@/lib/connection-state.server");
          attemptId = await markAttemptOutcome({
            state,
            attemptState,
            reason,
            ...(markers ?? {}),
          });
        };

        const url = new URL(request.url);
        const origin = url.origin;
        const state = url.searchParams.get("state") ?? "";
        const code = url.searchParams.get("code") ?? "";
        const denied = url.searchParams.get("error_description") ?? url.searchParams.get("error");

        if (!state) {
          await auditOutcome("failed", null, null, null, "No state parameter in the callback");
          return complete(origin, { outcome: "error", code: "state_invalid" });
        }

        const {
          consumeState,
          exchangeCode,
          ProviderTokenError,
          upgradeMetaToken,
          metaGrantedScopes,
        } = await import("@/lib/oauth.server");
        const row = await consumeState(state);
        if (!row) {
          await auditOutcome(
            "expired",
            null,
            null,
            null,
            "State was already used or older than its expiry — start the connection again",
          );
          // The row still exists, it just could not be consumed, so the waiting
          // tab can still be told which attempt this was about.
          const { attemptIdForState } = await import("@/lib/connection-state.server");
          return complete(origin, {
            outcome: "expired",
            attemptId: await attemptIdForState(state),
          });
        }
        if (denied || !code) {
          await markAttemptState(
            "cancelled",
            "The provider refused the request or the person declined it",
            { code: "access_denied" },
          );
          await auditOutcome(
            "cancelled",
            row.platform,
            row.tenant_id,
            row.user_id ?? null,
            denied
              ? `Provider refused or the user declined: ${String(denied).slice(0, 200)}`
              : "Provider returned no authorization code",
          );
          // A cancellation is not an error. Reporting it as one sent people
          // hunting for a fault when they had simply pressed Cancel.
          return complete(origin, {
            outcome: "cancelled",
            platform: row.platform,
            attemptId,
          });
        }

        const { connector } = await import("@/lib/connections-catalog");
        const meta = connector(row.platform);
        if (!meta?.provider) {
          await markAttemptState(
            "callback_error",
            "No OAuth provider is configured for this platform",
            { code: "connect_failed" },
          );
          await auditOutcome(
            "failed",
            row.platform,
            row.tenant_id,
            row.user_id ?? null,
            "No OAuth provider is configured for this platform",
          );
          return complete(origin, {
            outcome: "error",
            code: "connect_failed",
            platform: row.platform,
            attemptId,
          });
        }

        try {
          let tokens = await exchangeCode({
            provider: meta.provider,
            code,
            redirectUri: row.redirect_uri,
            tenantId: row.tenant_id,
            codeVerifier: row.code_verifier, // real PKCE for twitter/X
          });

          let metaLongLived = false;
          if (meta.provider === "meta") {
            // Meta's code exchange yields a short-lived user token (1-2 hours).
            // Upgrade it now: Page tokens taken from a long-lived user token do
            // not expire, ones taken from a short-lived token die with it. A
            // failed upgrade keeps the short-lived token -- the connection
            // still works and shows as expiring -- rather than turning a good
            // login into an error.
            try {
              const longLived = await upgradeMetaToken(tokens.token, row.tenant_id);
              tokens = { ...tokens, token: longLived.token, expiresAt: longLived.expiresAt };
              metaLongLived = true;
            } catch {
              console.error(
                "[oauth-callback] Meta long-lived token exchange failed; keeping the short-lived token",
              );
            }
            const granted = await metaGrantedScopes(tokens.token);
            if (granted) tokens = { ...tokens, scopes: granted };
          }
          const { discoverProfile, saveAuthorizedConnection } =
            await import("@/lib/connections.server");
          const platform = row.platform as Parameters<typeof discoverProfile>[0];

          // Meta needs a real look at what this login can actually reach
          // before we call it connected. Saving a Page-less or Instagram-less
          // authorization as "connected" is how an account ends up green in
          // the UI while doing nothing.
          let metaSole: import("@/lib/meta-discovery.server").MetaPage | null = null;
          if (platform === "facebook" || platform === "instagram") {
            const {
              discoverMetaTargets,
              diagnoseMetaConnection,
              needsTargetSelection,
              soleTarget,
            } = await import("@/lib/meta-discovery.server");
            const discovery = await discoverMetaTargets(tokens.token);
            const diagnosis = diagnoseMetaConnection(discovery, platform);
            if (diagnosis) {
              // Stop here rather than storing a connection that cannot work.
              // Pass the explanation through, not just the headline -- the
              // user lands on a page that has no other way to learn what went
              // wrong, and nothing was saved for them to re-query.
              //
              // Recorded on the attempt too. Without this the row stayed
              // "callback_received" and the waiting tab, which reads the row
              // rather than the URL, would have gone on waiting for an
              // authorization that had already been refused.
              await markAttemptState("callback_error", diagnosis.message, {
                code: "no_eligible_target",
              });
              await auditOutcome(
                "blocked",
                row.platform,
                row.tenant_id,
                row.user_id ?? null,
                diagnosis.title,
              );
              return complete(origin, {
                outcome: "blocked",
                platform,
                attemptId,
                reason: diagnosis.title,
                detail: diagnosis.message,
                ...(diagnosis.helpUrl ? { help: diagnosis.helpUrl } : {}),
              });
            }
            if (needsTargetSelection(discovery, platform)) {
              // More than one Page/account qualifies — the user must choose
              // rather than us silently taking whichever came back first.
              const pendingId = await saveAuthorizedConnection({
                tenantId: row.tenant_id,
                platform,
                token: tokens.token,
                refreshToken: tokens.refreshToken,
                expiresAt: tokens.expiresAt,
                grantedScopes: tokens.scopes,
                profile: {},
                permissions: [...capabilityCeiling(platform)],
              });
              // The authorization itself finished; only the choice of Page
              // remains. Without this the attempt later read as "expired".
              await markAttemptState(
                "completed",
                "Authorized; waiting for the customer to choose which Page to connect",
                { targetAccountId: pendingId ?? null },
              );
              // The pending row's own id, so the picker opens on the row this
              // login just created -- not the first row for the platform,
              // which once several channels can be connected is often another.
              return complete(origin, {
                outcome: "select_target",
                platform,
                accountId: pendingId ?? null,
                attemptId,
              });
            }
            metaSole = soleTarget(discovery, platform);
          }

          // For a single Meta target, use what discovery already found rather
          // than looking again. discoverProfile() takes the first Page Meta
          // returns, which for Instagram is the wrong one whenever the linked
          // Instagram account sits on any other Page -- that saved an empty
          // connection shown as "connected". And a Facebook Page must be
          // operated with its own Page token: saving the user token made
          // comment replies and Messenger reads fail silently.
          // LinkedIn and Business Profile logins can manage several channels.
          // Ask the provider which, and let the customer choose when there is
          // more than one. A login that manages none -- or that the provider
          // will not list yet -- stops here with the reason, rather than saving
          // a connection that can never sync.
          let chosenTarget: import("@/lib/connection-targets.server").ConnectionTarget | null =
            null;
          if ((await import("@/lib/connection-targets.server")).hasTargetDiscovery(platform)) {
            const { listConnectionTargets, noTargetReason } =
              await import("@/lib/connection-targets.server");
            const listed = await listConnectionTargets(platform, tokens.token);
            if (!listed.ok || listed.targets.length === 0) {
              const why = listed.ok ? noTargetReason(platform) : listed.reason;
              await markAttemptState("callback_error", why.slice(0, 200), {
                code: "no_eligible_target",
              });
              await auditOutcome("blocked", row.platform, row.tenant_id, row.user_id ?? null, why);
              return complete(origin, {
                outcome: "blocked",
                platform,
                attemptId,
                reason: listed.ok ? "Nothing to connect" : "Could not list your accounts",
                detail: why,
              });
            }
            if (listed.targets.length > 1) {
              const pendingTargetId = await saveAuthorizedConnection({
                tenantId: row.tenant_id,
                platform,
                token: tokens.token,
                refreshToken: tokens.refreshToken,
                expiresAt: tokens.expiresAt,
                grantedScopes: tokens.scopes,
                profile: {},
                permissions: [...capabilityCeiling(platform)],
              });
              await markAttemptState(
                "completed",
                "Authorized; waiting for the customer to choose which account to connect",
                { targetAccountId: pendingTargetId ?? null },
              );
              return complete(origin, {
                outcome: "select_target",
                platform,
                accountId: pendingTargetId ?? null,
                attemptId,
              });
            }
            chosenTarget = listed.targets[0]!;
          }

          let saveToken = tokens.token;
          let saveExpiresAt = tokens.expiresAt;
          let profile: Awaited<ReturnType<typeof discoverProfile>>;
          if (metaSole && platform === "instagram" && metaSole.instagram) {
            const ig = metaSole.instagram;
            profile = {
              external_id: ig.id,
              name: ig.name ?? ig.username ?? metaSole.name,
              username: ig.username ?? undefined,
              picture: ig.picture ?? undefined,
              followers: ig.followers ?? undefined,
              bio: ig.biography ?? undefined,
              website: ig.website ?? undefined,
              profile_url: ig.username ? `https://instagram.com/${ig.username}` : undefined,
            };
          } else if (metaSole && platform === "facebook") {
            profile = {
              external_id: metaSole.id,
              name: metaSole.name,
              username: metaSole.username ?? undefined,
              category: metaSole.category ?? undefined,
              picture: metaSole.picture ?? undefined,
              followers: metaSole.followers ?? undefined,
              profile_url: metaSole.profileUrl ?? undefined,
            };
            if (metaSole.pageAccessToken) {
              saveToken = metaSole.pageAccessToken;
              // A Page token taken from a long-lived user token has no expiry.
              // Recording the user token's 60-day date would have the health
              // check "refresh" it with fb_exchange_token -- a user-token
              // operation -- and mark a working Page as broken.
              if (metaLongLived) saveExpiresAt = null;
            }
          } else if (chosenTarget) {
            const { targetProfile } = await import("@/lib/connection-targets.server");
            profile = targetProfile(chosenTarget);
          } else {
            profile = await discoverProfile(platform, tokens.token);
          }
          const savedAccountId = await saveAuthorizedConnection({
            tenantId: row.tenant_id,
            platform,
            token: saveToken,
            refreshToken: tokens.refreshToken,
            expiresAt: saveExpiresAt,
            grantedScopes: tokens.scopes,
            profile,
            permissions: [...capabilityCeiling(platform)],
          });
          // The saved row's id travels on the attempt, so the waiting tab can
          // offer "check what works" against the account this click created
          // rather than guessing at the first row for the platform.
          await markAttemptState("completed", "The account was connected", {
            accountId: savedAccountId ?? null,
          });
          await auditOutcome(
            "succeeded",
            row.platform,
            row.tenant_id,
            row.user_id ?? null,
            "Connected",
          );
          return complete(origin, {
            outcome: "connected",
            platform: row.platform,
            attemptId,
          });
        } catch (e) {
          // Log the raw error server-side, but only leak a sanitized code to
          // the browser URL (previous version echoed full SDK error text).
          // Redacted before it reaches the log. A provider error frequently
          // echoes the request, and the request carried the token — so an
          // unfiltered console.error puts a live credential into whatever
          // aggregates stdout, where it outlives the token itself.
          const { redactSecrets } = await import("@/lib/integration-errors.server");
          const safeMessage =
            redactSecrets(e instanceof Error ? e.message : String(e)) ?? "Authorization failed";
          console.error("[oauth-callback] failed:", safeMessage);

          // Also record it against the workspace, so a failed connection is
          // visible in the manager portal instead of only in a console nobody
          // reads. A connect failure the customer cannot explain is the single
          // most common support message, and until now the only trace of it
          // was a sanitised code in their address bar.
          try {
            const { normalizeProviderError, recordIntegrationError } =
              await import("@/lib/integration-errors.server");
            await recordIntegrationError({
              tenantId: row.tenant_id,
              platform: row.platform,
              feature: "oauth",
              operation: "oauth_callback",
              // A refusal carries the provider's own status and body, so the
              // Meta code table can name the actual cause. Without them
              // normalizeProviderError files every refusal as a transient
              // network fault and tells the customer to wait for a retry that
              // will never succeed.
              error:
                e instanceof ProviderTokenError
                  ? normalizeProviderError({
                      platform: row.platform,
                      httpStatus: e.httpStatus,
                      body: e.body,
                      thrown: e,
                    })
                  : normalizeProviderError({ platform: row.platform, thrown: e }),
            });
          } catch (recordError) {
            // Reporting must never turn a failed connection into a 500.
            console.error("[oauth-callback] could not record error", recordError);
          }

          const failureCode = sanitizeError(e);
          await markAttemptState("callback_error", safeMessage.slice(0, 200), {
            code: failureCode,
          });
          await auditOutcome(
            "failed",
            row.platform,
            row.tenant_id,
            row.user_id ?? null,
            safeMessage.slice(0, 300),
          );
          // Only the code travels. The redacted message is already on the
          // attempt row, where reading it needs the caller to own the attempt.
          return complete(origin, {
            outcome: "error",
            code: failureCode,
            platform: row.platform,
            attemptId,
          });
        }
      },
    },
  },
});
