// Platform OAuth redirect target. The caller is authenticated by the
// single-use, unguessable state row created when the flow started — no session
// is required, and no code is trusted without a matching live state.
import { createFileRoute } from "@tanstack/react-router";

function back(origin: string, params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  return new Response(null, { status: 302, headers: { Location: `${origin}/social?${qs}` } });
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
        const url = new URL(request.url);
        const origin = url.origin;
        const state = url.searchParams.get("state") ?? "";
        const code = url.searchParams.get("code") ?? "";
        const denied = url.searchParams.get("error_description") ?? url.searchParams.get("error");

        if (!state)
          return back(origin, { connect_error: "Authorization response was incomplete." });

        const { consumeState, exchangeCode } = await import("@/lib/oauth.server");
        const row = await consumeState(state);
        if (!row) {
          return back(origin, {
            connect_error: "This authorization link expired. Please start the connection again.",
          });
        }
        if (denied || !code) {
          return back(origin, {
            connect_error: `Authorization was not completed for ${row.platform.replace(/_/g, " ")}.`,
          });
        }

        const { connector } = await import("@/lib/connections-catalog");
        const meta = connector(row.platform);
        if (!meta?.provider) {
          return back(origin, { connect_error: "Unsupported platform." });
        }

        try {
          const tokens = await exchangeCode({
            provider: meta.provider,
            code,
            redirectUri: row.redirect_uri,
            tenantId: row.tenant_id,
            codeVerifier: row.code_verifier, // real PKCE for twitter/X
          });
          const { discoverProfile, saveAuthorizedConnection } =
            await import("@/lib/connections.server");
          const platform = row.platform as Parameters<typeof discoverProfile>[0];

          // Meta needs a real look at what this login can actually reach
          // before we call it connected. Saving a Page-less or Instagram-less
          // authorization as "connected" is how an account ends up green in
          // the UI while doing nothing.
          if (platform === "facebook" || platform === "instagram") {
            const { discoverMetaTargets, diagnoseMetaConnection, needsTargetSelection } =
              await import("@/lib/meta-discovery.server");
            const discovery = await discoverMetaTargets(tokens.token);
            const diagnosis = diagnoseMetaConnection(discovery, platform);
            if (diagnosis) {
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
            if (needsTargetSelection(discovery, platform)) {
              // More than one Page/account qualifies — the user must choose
              // rather than us silently taking whichever came back first.
              await saveAuthorizedConnection({
                tenantId: row.tenant_id,
                platform,
                token: tokens.token,
                refreshToken: tokens.refreshToken,
                expiresAt: tokens.expiresAt,
                grantedScopes: tokens.scopes,
                profile: {},
                permissions: meta.capabilities,
              });
              return back(origin, { connected: platform, select_target: "1" });
            }
          }

          const profile = await discoverProfile(platform, tokens.token);
          await saveAuthorizedConnection({
            tenantId: row.tenant_id,
            platform,
            token: tokens.token,
            refreshToken: tokens.refreshToken,
            expiresAt: tokens.expiresAt,
            grantedScopes: tokens.scopes,
            profile,
            permissions: meta.capabilities,
          });
          return back(origin, { connected: row.platform });
        } catch (e) {
          // Log the raw error server-side, but only leak a sanitized code to
          // the browser URL (previous version echoed full SDK error text).
          console.error("[oauth-callback] failed", e);

          // Also record it against the workspace, so a failed connection is
          // visible in the manager portal instead of only in a console nobody
          // reads. A connect failure the customer cannot explain is the single
          // most common support message, and until now the only trace of it
          // was a sanitised code in their address bar.
          try {
            const { normalizeProviderError, recordIntegrationError } = await import(
              "@/lib/integration-errors.server"
            );
            await recordIntegrationError({
              tenantId: row.tenant_id,
              platform: row.platform,
              feature: "oauth",
              operation: "oauth_callback",
              error: normalizeProviderError({ platform: row.platform, thrown: e }),
            });
          } catch (recordError) {
            // Reporting must never turn a failed connection into a 500.
            console.error("[oauth-callback] could not record error", recordError);
          }

          return back(origin, { connect_error: sanitizeError(e), platform: row.platform });
        }
      },
    },
  },
});
