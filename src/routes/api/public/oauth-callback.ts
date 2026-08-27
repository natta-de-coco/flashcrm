// Platform OAuth redirect target. The caller is authenticated by the
// single-use, unguessable state row created when the flow started — no session
// is required, and no code is trusted without a matching live state.
import { createFileRoute } from "@tanstack/react-router";

function back(origin: string, params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  return new Response(null, { status: 302, headers: { Location: `${origin}/social?${qs}` } });
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

        if (!state) return back(origin, { connect_error: "Authorization response was incomplete." });

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
          const { token, expiresAt } = await exchangeCode({
            provider: meta.provider,
            code,
            redirectUri: row.redirect_uri,
            tenantId: row.tenant_id,
          });
          const { discoverProfile, saveAuthorizedConnection } = await import(
            "@/lib/connections.server"
          );
          const platform = row.platform as Parameters<typeof discoverProfile>[0];
          const profile = await discoverProfile(platform, token);
          await saveAuthorizedConnection({
            tenantId: row.tenant_id,
            platform,
            token,
            expiresAt,
            profile,
            permissions: meta.capabilities,
          });
          return back(origin, { connected: row.platform });
        } catch (e) {
          return back(origin, {
            connect_error: e instanceof Error ? e.message : "Connection failed.",
          });
        }
      },
    },
  },
});
