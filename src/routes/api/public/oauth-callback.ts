// Platform OAuth redirect target. The caller is authenticated by the
// single-use, unguessable state row created when the flow started — no session
// is required, and no code is trusted without a matching live state.
import { isUserCancellation } from "@/lib/oauth-outcome";
import { createFileRoute } from "@tanstack/react-router";
import { capabilityCeiling } from "@/lib/social-connector-definitions";

function back(origin: string, params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  return new Response(null, {
    status: 302,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      Location: `${origin}/connect?${qs}`,
    },
  });
}

/** Map raw provider/SDK errors to a small set of user-safe codes.  Prevents
 *  tokens, IDs, internal paths from leaking into the browser URL bar / referer
 *  logs (the whole `Location: /social?connect_error=...` shows up there). */
function sanitizeError(raw: unknown): string {
  const msg = raw instanceof Error ? raw.message : String(raw ?? "");
  const low = msg.toLowerCase();
  if (low.includes("credentials are missing")) return "platform_app_missing";
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
        const markAttemptState = async (
          attemptState: "callback_received" | "cancelled" | "callback_error" | "completed",
          reason: string,
        ) => {
          if (!state) return;
          const { markAttempt } = await import("@/lib/connection-state.server");
          await markAttempt(state, attemptState, reason);
        };

        const url = new URL(request.url);
        const origin = url.origin;
        const state = url.searchParams.get("state") ?? "";
        const code = url.searchParams.get("code") ?? "";
        const providerError = url.searchParams.get("error");
        const denied = url.searchParams.get("error_description") ?? providerError;

        if (!state) {
          await auditOutcome("failed", null, null, null, "No state parameter in the callback");
          return back(origin, {
            connect_error: "Authorization response was incomplete.",
            connect_code: "incomplete",
          });
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
          return back(origin, {
            connect_error: "This authorization link expired. Please start the connection again.",
            connect_code: "expired",
          });
        }
        if (denied || !code) {
          await markAttemptState(
            "cancelled",
            "The provider refused the request or the person declined it",
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
          // Pressing Cancel is a choice, not a failure: it gets its own calm
          // outcome instead of "Connection failed -- ask an administrator".
          if (denied && isUserCancellation(providerError, url.searchParams.get("error_reason"))) {
            return back(origin, { connect_cancelled: row.platform });
          }
          return back(origin, {
            connect_error: `Authorization was not completed for ${row.platform.replace(/_/g, " ")}.`,
            connect_code: denied ? "provider_refused" : "incomplete",
            connect_platform: row.platform,
          });
        }

        const { connector } = await import("@/lib/connections-catalog");
        const meta = connector(row.platform);
        if (!meta?.provider) {
          await auditOutcome(
            "failed",
            row.platform,
            row.tenant_id,
            row.user_id ?? null,
            "No OAuth provider is configured for this platform",
          );
          return back(origin, { connect_error: "Unsupported platform." });
        }

        try {
          let tokens = await exchangeCode({
            provider: meta.provider,
            code,
            redirectUri: row.redirect_uri,
            tenantId: row.tenant_id,
            codeVerifier: row.code_verifier, // real PKCE for twitter/X
          });

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
          if (platform === "facebook" || platform === "instagram") {
            const { discoverMetaTargets, diagnoseMetaConnection } =
              await import("@/lib/meta-discovery.server");
            const discovery = await discoverMetaTargets(tokens.token);
            const diagnosis = diagnoseMetaConnection(discovery, platform);
            if (diagnosis) {
              await markAttemptState("callback_error", diagnosis.title);
              await auditOutcome(
                "blocked",
                row.platform,
                row.tenant_id,
                row.user_id ?? null,
                diagnosis.title,
              );
              // Stop here rather than storing a connection that cannot work.
              // Pass the explanation through, not just the headline -- the
              // user lands on a page that has no other way to learn what went
              // wrong, and nothing was saved for them to re-query.
              return back(origin, {
                connect_blocked: platform,
                connect_reason: diagnosis.title,
                connect_detail: diagnosis.message,
                ...(diagnosis.helpUrl ? { connect_help: diagnosis.helpUrl } : {}),
              });
            }
            {
              // Confirm the Page/account explicitly, even when only one is available.
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
              );
              // The pending row's own id, so the picker opens on the row this
              // login just created -- not the first row for the platform,
              // which once several channels can be connected is often another.
              return back(origin, { connected: platform, select_target: pendingId ?? "1" });
            }
          }

          // Ask the provider which asset this grant can manage, then require a choice.
          if ((await import("@/lib/connection-targets.server")).hasTargetDiscovery(platform)) {
            const { listConnectionTargets, noTargetReason } =
              await import("@/lib/connection-targets.server");
            const listed = await listConnectionTargets(platform, tokens.token);
            if (!listed.ok || listed.targets.length === 0) {
              const customerReason = listed.ok ? noTargetReason(platform) : listed.reason;
              const diagnostic = listed.ok ? customerReason : (listed.diagnostic ?? customerReason);
              await markAttemptState("callback_error", diagnostic.slice(0, 200));
              await auditOutcome(
                "blocked",
                row.platform,
                row.tenant_id,
                row.user_id ?? null,
                diagnostic,
              );
              return back(origin, {
                connect_blocked: platform,
                connect_reason: customerReason,
                // Detailed discovery evidence stays in the tenant audit log.
              });
            }
            {
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
              );
              return back(origin, { connected: platform, select_target: pendingTargetId ?? "1" });
            }
          }

          const profile = await discoverProfile(platform, tokens.token);
          if (!profile.external_id)
            throw new Error("The provider did not identify an account. Please connect again.");
          const accountId = await saveAuthorizedConnection({
            tenantId: row.tenant_id,
            platform,
            token: tokens.token,
            refreshToken: tokens.refreshToken,
            expiresAt: tokens.expiresAt,
            grantedScopes: tokens.scopes,
            profile,
            permissions: [...capabilityCeiling(platform)],
          });
          await markAttemptState("completed", "The account was connected");
          await auditOutcome(
            "succeeded",
            row.platform,
            row.tenant_id,
            row.user_id ?? null,
            "Connected",
          );
          return back(origin, {
            connected: row.platform,
            ...(accountId ? { account_id: accountId } : {}),
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

          await markAttemptState("callback_error", safeMessage.slice(0, 200));
          await auditOutcome(
            "failed",
            row.platform,
            row.tenant_id,
            row.user_id ?? null,
            safeMessage.slice(0, 300),
          );
          return back(origin, { connect_error: sanitizeError(e), platform: row.platform });
        }
      },
    },
  },
});
