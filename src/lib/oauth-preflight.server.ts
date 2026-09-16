import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { encryptionConfigured } from "./secret-box.server";
import { resolveAllowedOrigin, resolveCredentials } from "./oauth.server";
import type { Connector } from "./connections-catalog";

export function publicAppOrigin(): string | null {
  try {
    const url = new URL((process.env["PUBLIC_APP_URL"] ?? "").trim());
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    if (
      url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Shared by readiness and authorization. No OAuth state or audit writes. */
export async function oauthPreflight(
  provider: NonNullable<Connector["provider"]>,
  tenantId: string | null,
  origin: string,
) {
  let credentialError = false;
  let credentials: Awaited<ReturnType<typeof resolveCredentials>> = {
    id: undefined,
    secret: undefined,
    source: "shared",
  };
  try {
    credentials = await resolveCredentials(provider, tenantId);
  } catch {
    // Never return decryption errors or provider credential values to a browser.
    credentialError = true;
  }
  let encryption = false;
  try {
    encryption = await encryptionConfigured();
  } catch {
    /* invalid keyring is a blocker */
  }
  const publicOrigin = publicAppOrigin();
  const allowedOrigin = resolveAllowedOrigin(origin);
  let storage = false;
  try {
    const results = await Promise.all([
      supabaseAdmin
        .from("oauth_states")
        .select("id, state_hash, redirect_uri, code_verifier, used_at, attempt_state")
        .limit(0),
      supabaseAdmin
        .from("social_accounts")
        .select("id, external_id, connection_state, granted_scopes")
        .limit(0),
    ]);
    const guard = await supabaseAdmin.rpc("integration_oauth_storage_ready");
    storage = results.every((result) => !result.error) && !guard.error && guard.data === true;
  } catch {
    /* missing migrations or database access must block sign-in */
  }
  const checks = {
    storage,
    workspace: Boolean(tenantId),
    credentials: !credentialError && Boolean(credentials.id?.trim() && credentials.secret?.trim()),
    publicAppUrl: Boolean(publicOrigin),
    allowedOrigin: Boolean(allowedOrigin),
    encryption,
  };
  return {
    credentials,
    credentialError,
    publicOrigin,
    allowedOrigin,
    checks,
    ready: Object.values(checks).every(Boolean),
  };
}
