/*
 * The Connection Center's readiness endpoints.
 *
 * Thin on purpose: every rule about who may see what lives in
 * connection-readiness.server.ts, where it is covered by tests. These functions
 * establish who is asking, hand that to the engine, and return what it says.
 *
 * Three audiences, one engine:
 * - getConnectionAvailability: any signed-in member. Can I connect, and if not,
 *   what am I told? Every problem passes through forAudience() for the caller,
 *   so a setting name can never reach someone who cannot change it.
 * - getProviderReadiness: administrators. The full diagnosis.
 * - testProviderCredentials: asks the provider whether the app keys are real.
 */
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { PROVIDER_NAMES, type OAuthProviderId } from "@/lib/connection-problem";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

type Client = SupabaseClient<Database>;

const PROVIDER_IDS = Object.keys(PROVIDER_NAMES) as [OAuthProviderId, ...OAuthProviderId[]];

/** The origin is the caller's own address; it is validated against the server's allowlist. */
const OriginSchema = z.object({ origin: z.string().url().optional() });
const TestSchema = z.object({
  provider: z.enum(PROVIDER_IDS),
  origin: z.string().url().optional(),
});

type CallerRole = {
  superAdmin: boolean;
  workspaceAdmin: boolean;
  tenantId: string | null;
};

/**
 * Who is asking, from their own profile row read as themselves.
 *
 * Same source as every other admin check in the app (companies.functions.ts
 * requireSuperAdmin, connections.functions.ts encryptStoredCredentials), so
 * there is one definition of "admin" rather than a second one here.
 */
async function callerRole(supabase: Client, userId: string): Promise<CallerRole> {
  const { data } = await supabase
    .from("profiles")
    .select("tenant_id, staff_role")
    .eq("id", userId)
    .maybeSingle();
  const staffRole = String(data?.staff_role ?? "");
  return {
    superAdmin: staffRole === "super_admin",
    workspaceAdmin: staffRole === "company_admin" || staffRole === "super_admin",
    tenantId: data?.tenant_id ?? null,
  };
}

/**
 * What every signed-in member may see: whether each provider can be connected,
 * and one problem written for them when it cannot.
 */
export const getConnectionAvailability = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => OriginSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const role = await callerRole(context.supabase, context.userId);
    const { availabilityForCaller, evaluateAllProviders } =
      await import("@/lib/connection-readiness.server");
    const providers = await evaluateAllProviders({
      tenantId: role.tenantId,
      origin: data.origin ?? null,
    });
    return providers.map((readiness) => availabilityForCaller(readiness, role));
  });

/**
 * The full diagnosis, for people who can act on it.
 *
 * A workspace admin sees their own workspace's view: problems they own in full,
 * and Flas's own deployment problems as the plain "administrator setup needed"
 * everyone else gets -- without the setting names, console links and masked ids
 * that belong to the Flas platform manager.
 */
export const getProviderReadiness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => OriginSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const role = await callerRole(context.supabase, context.userId);
    const {
      canViewProviderReadiness,
      evaluateAllProviders,
      readinessForCaller,
      READINESS_REFUSAL,
    } = await import("@/lib/connection-readiness.server");
    if (!canViewProviderReadiness(role)) throw new Error(READINESS_REFUSAL);

    const providers = await evaluateAllProviders({
      tenantId: role.tenantId,
      origin: data.origin ?? null,
    });
    return providers.map((readiness) => readinessForCaller(readiness, role));
  });

/**
 * Asks the provider whether the app keys in use are the ones it knows.
 *
 * Super admins may test any provider. A workspace admin may test only an app
 * their own workspace supplied: testing the shared Flas app would let any
 * customer probe a credential that is not theirs.
 */
export const testProviderCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TestSchema.parse(input))
  .handler(async ({ data, context }) => {
    const role = await callerRole(context.supabase, context.userId);
    const provider = data.provider;
    const name = PROVIDER_NAMES[provider];

    const { resolveAllowedOrigin, resolveCredentials, oauthRedirectUri } =
      await import("@/lib/oauth.server");
    const {
      canTestCredentials,
      checkCredentialTestRateLimit,
      credentialProblem,
      CREDENTIAL_TEST_REFUSAL,
      originProblem,
      problemForCaller,
    } = await import("@/lib/connection-readiness.server");

    const creds = await resolveCredentials(provider, role.tenantId);
    const source = creds.id && creds.secret ? creds.source : "none";
    if (!canTestCredentials(role, source)) throw new Error(CREDENTIAL_TEST_REFUSAL);

    const base = {
      provider,
      httpStatus: null as number | null,
      providerErrorCode: null as string | null,
      testedAt: new Date().toISOString(),
      rateLimited: false,
      retryAfterSeconds: 0,
    };

    if (!creds.id || !creds.secret) {
      const problem = await credentialProblem({
        provider,
        tenantId: role.tenantId,
        missing: !creds.id ? "id" : "secret",
      });
      return {
        ...base,
        status: "inconclusive" as const,
        message: `There are no ${name} app keys to test yet.`,
        problem: problemForCaller(problem, role),
      };
    }

    // The address the provider would really return to, validated the same way
    // startConnect validates it -- never a hardcoded production origin.
    const candidate = data.origin ?? process.env["PUBLIC_APP_URL"] ?? null;
    const allowedOrigin = candidate ? resolveAllowedOrigin(candidate) : null;
    if (!allowedOrigin) {
      const problem = originProblem(candidate);
      return {
        ...base,
        status: "inconclusive" as const,
        message: "Flas cannot test these keys until its own return address is configured.",
        problem: problemForCaller(problem, role),
      };
    }

    // Before the provider is called, so a held-down button cannot become a
    // burst of requests against a token endpoint.
    const limit = checkCredentialTestRateLimit(provider);
    if (!limit.allowed) {
      return {
        ...base,
        status: "inconclusive" as const,
        rateLimited: true,
        retryAfterSeconds: limit.retryAfterSeconds,
        message: `${name} was just checked. Try again in ${limit.retryAfterSeconds} seconds.`,
        problem: null,
      };
    }

    const { testProviderCredentials: runCredentialTest } =
      await import("@/lib/provider-credential-test.server");
    const result = await runCredentialTest({
      provider,
      id: creds.id,
      secret: creds.secret,
      redirectUri: oauthRedirectUri(allowedOrigin),
      name,
    });

    // Only the verdict, the HTTP status and a code from the documented list.
    // Never a key, a token, or anything the provider wrote.
    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "provider.credential_test",
      tenantId: role.tenantId,
      actorId: context.userId,
      entityType: "oauth_provider",
      entityId: provider,
      details: {
        provider,
        status: result.status,
        httpStatus: result.httpStatus,
        providerErrorCode: result.providerErrorCode,
        credentialSource: source,
      },
    });

    return {
      ...base,
      httpStatus: result.httpStatus,
      providerErrorCode: result.providerErrorCode,
      testedAt: result.testedAt,
      status: result.status,
      message: result.message,
      problem: null,
    };
  });
