// Server-only helpers for tenant-scoped API keys.
import { createHash, randomBytes } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Generates a new API key. The raw value is shown to the user exactly once. */
export function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const raw = `flas_${randomBytes(24).toString("hex")}`;
  return { raw, prefix: raw.slice(0, 12), hash: hashApiKey(raw) };
}

export type ApiKeyAuth = { keyId: string; tenantId: string | null; scopes: string[] };

/** How stale a "last used" stamp may be before it is worth another write. */
const LAST_USED_PRECISION_MS = 5 * 60 * 1000;

/**
 * Authenticates an external API call via `Authorization: Bearer flas_...`
 * (or `X-Api-Key`). Returns null for unknown or revoked keys.
 */
export async function authenticateApiKey(request: Request): Promise<ApiKeyAuth | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : (request.headers.get("x-api-key") ?? "").trim();
  if (!token.startsWith("flas_")) return null;

  const { data } = await supabaseAdmin
    .from("api_keys")
    .select("id, tenant_id, scopes, revoked_at, last_used_at")
    .eq("key_hash", hashApiKey(token))
    .maybeSingle();
  if (!data || data.revoked_at) return null;

  // "Last used" is shown to the day, so writing it on every single request
  // only added write pressure a caller could deliberately amplify. A stamp
  // that is already fresh is left alone.
  const lastUsed = data.last_used_at ? Date.parse(data.last_used_at) : 0;
  if (!Number.isFinite(lastUsed) || Date.now() - lastUsed > LAST_USED_PRECISION_MS) {
    await supabaseAdmin
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", data.id);
  }

  return { keyId: data.id, tenantId: data.tenant_id, scopes: data.scopes ?? [] };
}
