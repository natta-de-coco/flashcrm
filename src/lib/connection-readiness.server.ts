/*
 * The Connection Center's self-diagnosis engine.
 *
 * One server-side answer to "can this provider actually be connected right
 * now, and if not, who has to do what": the checks the connect flow depends on,
 * each turned into a typed ConnectionProblem from the shared contract.
 *
 * Rules this module keeps:
 * - Nothing here ever returns, logs or stores a secret, a token, an encryption
 *   key or a whole app id. App ids appear masked, secrets only as a boolean.
 * - No check may throw. One provider failing must not hide the other five, so
 *   every check is wrapped and an unexpected failure becomes a problem of its
 *   own rather than a 500.
 * - Every probe is side-effect-free: reads with `limit(0)`, no RPC that
 *   consumes state, no request that mutates anything at a provider.
 * - The expected return address comes from validated configuration
 *   (OAUTH_ALLOWED_ORIGINS, falling back to PUBLIC_APP_URL) checked through
 *   oauth.server.ts's own allowlist. No production hostname is written down
 *   here, and the allowlist is never widened to make a check pass.
 *
 * State precedence, highest first:
 *   FLAS_CONFIGURATION_ERROR      Flas's own deployment is unconfigured or
 *                                 broken: return address, encryption key,
 *                                 service role, a pending migration, or an
 *                                 unexpected failure inside a check.
 *   NEEDS_CONFIGURATION           The app id or secret is missing, whoever owns
 *                                 it. Nothing can start without them.
 *   NEEDS_PROVIDER_CONFIGURATION  Credentials exist and the provider rejected
 *                                 them, so the app at the provider needs work.
 *   PROVIDER_ERROR                A check could not be completed because of the
 *                                 provider.
 *   NEEDS_PROVIDER_REVIEW         Connectable, but capabilities are gated behind
 *                                 the provider's app review.
 *   READY                         Nothing above applies.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  forAudience,
  maskId,
  PROVIDER_NAMES,
  type Audience,
  type ConnectionProblem,
  type OAuthProviderId,
  type ProblemOwner,
  type ProviderAvailability,
  type ProviderReadiness,
  type ReadinessState,
} from "@/lib/connection-problem";
import { CONNECTORS } from "@/lib/connections-catalog";
import { redactSecrets } from "@/lib/integration-errors.server";
import {
  configuredAllowedOrigins,
  oauthRedirectUri,
  PROVIDERS,
  providerEnvNames,
  resolveAllowedOrigin,
  resolveCredentials,
} from "@/lib/oauth.server";
import { PROVIDER_SETUP, type ProviderSetupLink } from "@/lib/provider-setup-links";
import { connectorDefinition } from "@/lib/social-connector-definitions";
import { encryptionConfigured, sealSecret } from "@/lib/secret-box.server";

/** Every provider family the connect flow knows, in a stable order. */
export const READINESS_PROVIDERS = Object.keys(PROVIDERS) as OAuthProviderId[];

export type ReadinessContext = {
  /** The workspace whose own app keys take precedence. null falls back to the shared Flas app. */
  tenantId: string | null;
  /**
   * The browser origin a Connect click would start from, exactly as startConnect
   * receives it. Validated against the allowlist here, never trusted. When it is
   * null the deployment's configured address is diagnosed instead.
   */
  origin: string | null;
};

/** Who is asking. Decides audience, not what the engine measures. */
export type CallerRole = {
  /** Flas platform manager: sees everything, for every workspace. */
  superAdmin: boolean;
  /** Admin of their own workspace (profiles.staff_role = company_admin). */
  workspaceAdmin: boolean;
  tenantId: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Problem builders. Plain English, correct owner, official link, no secrets.
// ─────────────────────────────────────────────────────────────────────────────

function setupLink(
  provider: OAuthProviderId,
  ...preferred: ProviderSetupLink["id"][]
): { url: string | undefined; urlLabel: string | undefined } {
  const links = PROVIDER_SETUP[provider].links;
  for (const id of preferred) {
    const hit = links.find((l) => l.id === id);
    if (hit) return { url: hit.url, urlLabel: hit.label };
  }
  const first = links[0];
  return { url: first?.url, urlLabel: first?.label };
}

/** The origin string as a bare origin, or a neutral phrase when it is unusable. */
function describeOrigin(candidate: string | null): string {
  if (!candidate) return "this address";
  try {
    return new URL(candidate).origin;
  } catch {
    return "this address";
  }
}

/**
 * The deployment was never told its own return address, or was told a different
 * one than the browser is using. Always Flas's to fix: OAUTH_ALLOWED_ORIGINS is
 * a deployment setting, not something a workspace can reach.
 */
export function originProblem(candidate: string | null): ConnectionProblem {
  const attempted = describeOrigin(candidate);
  const configured = configuredAllowedOrigins();
  const shared = {
    owner: "FLAS_ADMIN" as ProblemOwner,
    severity: "blocking" as const,
    userMessage:
      "This connection is temporarily unavailable because Flas has not finished its own setup. Nothing is wrong with your account.",
    retryable: false,
    technical: { setting: "OAUTH_ALLOWED_ORIGINS", detail: undefined },
  };
  if (configured.length === 0) {
    return {
      ...shared,
      code: "OAUTH_ORIGIN_MISSING",
      title: "Flas sign-in address is not configured",
      message: `Flas has not been told which address providers may return people to, so every sign-in is refused. Add ${attempted} to the server's OAuth allowlist.`,
      nextAction: `Set OAUTH_ALLOWED_ORIGINS to ${attempted} in the server's secrets and redeploy.`,
      copyValue: attempted === "this address" ? undefined : attempted,
      copyLabel: attempted === "this address" ? undefined : "Copy this address",
      technical: {
        setting: "OAUTH_ALLOWED_ORIGINS",
        detail:
          "Neither OAUTH_ALLOWED_ORIGINS nor PUBLIC_APP_URL is set, so the allowlist is loopback only.",
      },
    };
  }
  return {
    ...shared,
    code: "OAUTH_ORIGIN_NOT_ALLOWED",
    title: "This address is not an allowed sign-in return address",
    message: `${attempted} is not on the list of addresses providers may return people to, so sign-in is refused here.`,
    nextAction: `Add ${attempted} to OAUTH_ALLOWED_ORIGINS in the server's secrets and redeploy.`,
    copyValue: attempted === "this address" ? undefined : attempted,
    copyLabel: attempted === "this address" ? undefined : "Copy this address",
    technical: {
      setting: "OAUTH_ALLOWED_ORIGINS",
      detail: `${configured.length} origin(s) are configured; the caller's origin is not one of them.`,
    },
  };
}

/** PUBLIC_APP_URL missing while the allowlist is set: links and emails lose their address. */
function publicAppUrlProblem(): ConnectionProblem {
  return {
    code: "PUBLIC_APP_URL_MISSING",
    title: "Flas does not know its own web address",
    message:
      "Flas has an OAuth allowlist but no public address of its own, so links it builds for customers can point nowhere.",
    owner: "FLAS_ADMIN",
    severity: "warning",
    nextAction: "Set PUBLIC_APP_URL to this deployment's address in the server's secrets.",
    userMessage:
      "Some Flas links may be incomplete until an administrator finishes setup. Connecting still works.",
    retryable: false,
    technical: { setting: "PUBLIC_APP_URL" },
  };
}

/** True when this workspace has pasted an app of its own for the provider. */
async function workspaceAppPresent(
  tenantId: string | null,
  provider: OAuthProviderId,
): Promise<boolean> {
  if (!tenantId) return false;
  try {
    // client_id only. The secret is never read to answer a presence question.
    const { data } = await supabaseAdmin
      .from("platform_apps")
      .select("client_id")
      .eq("tenant_id", tenantId)
      .eq("provider", provider)
      .maybeSingle();
    return Boolean(data?.client_id);
  } catch {
    return false;
  }
}

/**
 * The app id or secret is missing.
 *
 * Owned by the workspace when the workspace has started pasting an app of its
 * own -- that half-filled row is theirs to finish, and naming a server
 * environment variable to them would be both useless and a leak. Otherwise the
 * shared Flas app is what is unconfigured, and that is a deployment setting.
 */
export async function credentialProblem(args: {
  provider: OAuthProviderId;
  tenantId: string | null;
  missing: "id" | "secret";
  redirectUri?: string | null;
}): Promise<ConnectionProblem> {
  const name = PROVIDER_NAMES[args.provider];
  const ownedByWorkspace = await workspaceAppPresent(args.tenantId, args.provider);
  const [idEnv, secretEnv] = providerEnvNames(args.provider);
  const link = setupLink(args.provider, "apps", "credentials", "docs");
  const thing = args.missing === "id" ? "App ID" : "App Secret";
  return {
    code: args.missing === "id" ? "PROVIDER_APP_ID_MISSING" : "PROVIDER_APP_SECRET_MISSING",
    title: `${name} ${thing} has not been added`,
    message: ownedByWorkspace
      ? `This workspace has its own ${name} app, but its ${thing} is missing, so no one can sign in to ${name}.`
      : `Flas has no ${name} ${thing} configured, so the ${name} sign-in cannot start.`,
    owner: ownedByWorkspace ? "WORKSPACE_ADMIN" : "FLAS_ADMIN",
    severity: "blocking",
    nextAction: ownedByWorkspace
      ? `Open Connect & setup → Platform app keys and paste the ${name} App ID and App Secret.`
      : `Add the ${name} app keys to the server's secrets, or paste this workspace's own ${name} keys under Connect & setup → Platform app keys.`,
    userMessage: `${name} cannot be connected yet because its setup is not finished. No action is needed from you.`,
    url: link.url,
    urlLabel: link.urlLabel,
    retryable: false,
    copyValue: args.redirectUri ?? undefined,
    copyLabel: args.redirectUri ? "Copy redirect URI" : undefined,
    technical: ownedByWorkspace
      ? {
          setting: undefined,
          detail: `platform_apps row for ${args.provider} in this workspace has no ${args.missing}.`,
        }
      : {
          setting: args.missing === "id" ? idEnv : secretEnv,
          detail: undefined,
        },
  };
}

/** A connector Flas cannot authorize at all yet. The reason is already customer-readable. */
export function connectorUnavailableProblem(
  platform: string,
  name: string,
  reason: string,
): ConnectionProblem {
  return {
    code: "CONNECTOR_UNAVAILABLE",
    title: `${name} cannot be connected yet`,
    message: reason,
    owner: "FLAS_ADMIN",
    severity: "blocking",
    nextAction: `Flas has to add support for the ${name} login before this card can work.`,
    // forAudience() shows userMessage to anyone who cannot fix it; the reason is
    // already plain English, so they see the real explanation rather than a
    // generic "administrator setup needed".
    userMessage: reason,
    retryable: false,
    technical: { detail: `connector ${platform} is marked unavailable in the catalogue.` },
  };
}

/** Flas could not record the single-use state row a sign-in needs. */
export function oauthStateWriteProblem(detail: string | null): ConnectionProblem {
  return {
    code: "OAUTH_STATE_UNAVAILABLE",
    title: "Flas could not start a secure sign-in",
    message:
      "Flas records a single-use token for every sign-in, and that record could not be written, so the sign-in was stopped rather than started without it.",
    owner: "FLAS_ADMIN",
    severity: "blocking",
    nextAction:
      "Check that the oauth_states table exists and the service-role key can write to it, then try again.",
    userMessage:
      "Flas could not start the secure sign-in. Try again shortly, and tell your administrator if it keeps happening.",
    retryable: true,
    technical: { detail: redactSecrets(detail) ?? undefined },
  };
}

function serviceRoleProblem(): ConnectionProblem {
  return {
    code: "SERVICE_ROLE_MISSING",
    title: "Flas cannot reach its own database",
    message:
      "The server has no database service key, so Flas cannot read the settings a connection needs or record a sign-in.",
    owner: "FLAS_ADMIN",
    severity: "blocking",
    nextAction:
      "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the server's secrets and redeploy.",
    userMessage:
      "Connections are temporarily unavailable while Flas finishes setup. Nothing is wrong with your account.",
    retryable: false,
    technical: { setting: "SUPABASE_SERVICE_ROLE_KEY" },
  };
}

function migrationProblem(detail: string | null): ConnectionProblem {
  return {
    code: "DATABASE_MIGRATION_PENDING",
    title: "The database is missing something connections need",
    message:
      "Part of the database the connect flow depends on is not there yet, so connecting would fail part-way through.",
    owner: "FLAS_ADMIN",
    severity: "blocking",
    nextAction: "Run the pending database migrations on this deployment, then check again.",
    userMessage:
      "Connections are temporarily unavailable while Flas finishes an update. Nothing is wrong with your account.",
    retryable: true,
    // The missing object is named here and nowhere else: it is administrator
    // detail, and forAudience() strips it for everyone else.
    technical: { detail: redactSecrets(detail) ?? undefined },
  };
}

function encryptionProblem(kind: "absent" | "invalid", detail: string | null): ConnectionProblem {
  if (kind === "invalid") {
    return {
      code: "TOKEN_ENCRYPTION_KEY_INVALID",
      title: "The token encryption key is not usable",
      message:
        "Flas has an encryption key configured, but it cannot be read, so it refuses to store any new credential rather than storing one unprotected.",
      owner: "FLAS_ADMIN",
      severity: "blocking",
      nextAction:
        "Fix TOKEN_ENCRYPTION_KEYS -- it must be id:base64key pairs, each key the base64 of 32 random bytes -- and redeploy.",
      userMessage:
        "Connecting is paused while Flas finishes its security setup. Nothing is wrong with your account.",
      retryable: false,
      technical: { setting: "TOKEN_ENCRYPTION_KEYS", detail: redactSecrets(detail) ?? undefined },
    };
  }
  return {
    code: "TOKEN_ENCRYPTION_NOT_CONFIGURED",
    title: "Stored credentials are not encrypted",
    message:
      "No encryption key is configured, so access tokens and app secrets are stored as they are rather than sealed.",
    owner: "FLAS_ADMIN",
    severity: "warning",
    nextAction:
      "Set TOKEN_ENCRYPTION_KEYS in the server's secrets, then run Encrypt stored credentials once.",
    userMessage:
      "Your connections work normally. An administrator has been asked to finish Flas's security setup.",
    retryable: false,
    technical: { setting: "TOKEN_ENCRYPTION_KEYS" },
  };
}

function reviewProblem(provider: OAuthProviderId, detail: string): ConnectionProblem {
  const name = PROVIDER_NAMES[provider];
  const link = setupLink(provider, "review", "permissions", "docs");
  return {
    code: "PROVIDER_REVIEW_REQUIRED",
    title: `${name} has to approve this app first`,
    message: `${name} keeps some of what Flas does behind its own app review, so those features stay switched off until ${name} approves the app.`,
    owner: "PROVIDER",
    severity: "warning",
    nextAction: `Submit the ${name} app for review, then reconnect once ${name} approves it.`,
    userMessage: `You can connect ${name} now. Some features stay unavailable until ${name} approves Flas's app.`,
    url: link.url,
    urlLabel: link.urlLabel,
    retryable: false,
    technical: { detail },
  };
}

function credentialTestFailedProblem(
  provider: OAuthProviderId,
  source: "workspace" | "shared" | "none",
  when: string | null,
): ConnectionProblem {
  const name = PROVIDER_NAMES[provider];
  const ownedByWorkspace = source === "workspace";
  const link = setupLink(provider, "apps", "credentials", "docs");
  return {
    code: "CREDENTIAL_TEST_FAILED",
    title: `${name} rejected these app keys`,
    message: `The last time Flas checked, ${name} refused the App ID and Secret in use, so a sign-in would fail.`,
    owner: ownedByWorkspace ? "WORKSPACE_ADMIN" : "FLAS_ADMIN",
    severity: "warning",
    nextAction: ownedByWorkspace
      ? `Re-copy the ${name} App ID and Secret from the ${name} app dashboard, paste them under Connect & setup → Platform app keys, and test again.`
      : `Re-copy the ${name} app keys into the server's secrets and test again.`,
    userMessage: `${name} is not accepting Flas's setup yet. An administrator has been asked to fix it.`,
    url: link.url,
    urlLabel: link.urlLabel,
    retryable: true,
    technical: { detail: when ? `Last credential test failed at ${when}.` : undefined },
  };
}

/** An unexpected failure inside a check: reported, never swallowed, never a 500. */
function internalProblem(what: string, error: unknown): ConnectionProblem {
  const detail = redactSecrets(error instanceof Error ? error.message : String(error));
  return {
    code: "FLAS_CONFIGURATION_ERROR",
    title: "Flas could not finish checking this connection",
    message: `Flas could not complete the ${what} check, so it cannot promise this connection will work.`,
    owner: "FLAS_ADMIN",
    severity: "blocking",
    nextAction: `Check the server logs for the ${what} check and try again.`,
    userMessage:
      "Flas could not check this connection just now. Try again shortly, and tell your administrator if it keeps happening.",
    retryable: true,
    technical: { detail: detail ?? undefined },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Probes. Side-effect-free, run once per evaluation and shared by all providers.
// ─────────────────────────────────────────────────────────────────────────────

/** Columns the connect and callback flow read. A `limit(0)` proves they exist. */
const REQUIRED_TABLES: ReadonlyArray<{
  table: "social_accounts" | "platform_apps";
  columns: string;
}> = [
  {
    table: "social_accounts",
    columns: "id, refresh_locked_until, connect_method, token_expires_at, health",
  },
  { table: "platform_apps", columns: "id, provider, client_id" },
];

/** Columns startAuthorization writes and the callback consumes. */
const OAUTH_STATE_COLUMNS = "id, state_hash, code_verifier, redirect_uri, expires_at, used_at";

export type ReadinessProbes = {
  serviceRoleConfigured: boolean;
  databaseReady: boolean;
  databaseDetail: string | null;
  oauthStateReady: boolean;
  oauthStateDetail: string | null;
  encryption: { configured: boolean; keysPresent: boolean; detail: string | null };
  /** Latest recorded credential test per provider. */
  credentialTests: Map<string, { at: string; status: string }>;
};

function serviceRoleConfigured(): boolean {
  return Boolean(process.env["SUPABASE_URL"] && process.env["SUPABASE_SERVICE_ROLE_KEY"]);
}

/**
 * Whether an encryption key is configured and usable.
 *
 * Absent and malformed are deliberately different answers: absent is the
 * documented "store unsealed" mode, malformed means sealSecret() will refuse to
 * store anything at all, which is a blocking fault. encryptionConfigured()
 * reports both as false, so the difference is drawn here.
 */
async function probeEncryption(): Promise<ReadinessProbes["encryption"]> {
  const keysPresent = Boolean(
    (process.env["TOKEN_ENCRYPTION_KEYS"] ?? "").trim() ||
    (process.env["TOKEN_ENCRYPTION_KEY"] ?? "").trim(),
  );
  let configured = false;
  try {
    configured = await encryptionConfigured();
  } catch {
    configured = false;
  }
  if (!keysPresent || configured) return { configured, keysPresent, detail: null };
  // Keys are set but unusable. Ask secret-box why, with a constant that is not
  // a secret and is thrown away. It never reaches storage.
  let detail: string | null = null;
  try {
    await sealSecret("flas-readiness-probe");
    detail = "The configured key could not be loaded.";
  } catch (error) {
    detail = redactSecrets(error instanceof Error ? error.message : String(error));
  }
  return { configured: false, keysPresent, detail };
}

/** Everything shared between providers, measured once. Never throws. */
export async function probeDeployment(ctx: ReadinessContext): Promise<ReadinessProbes> {
  const encryption = await probeEncryption();
  const credentialTests = new Map<string, { at: string; status: string }>();

  if (!serviceRoleConfigured()) {
    return {
      serviceRoleConfigured: false,
      databaseReady: false,
      databaseDetail: null,
      oauthStateReady: false,
      oauthStateDetail: null,
      encryption,
      credentialTests,
    };
  }

  let databaseReady = true;
  let databaseDetail: string | null = null;
  for (const required of REQUIRED_TABLES) {
    try {
      const { error } = await supabaseAdmin.from(required.table).select(required.columns).limit(0);
      if (error) {
        databaseReady = false;
        databaseDetail = `${required.table} (${required.columns}): ${error.message}`;
        break;
      }
    } catch (error) {
      databaseReady = false;
      databaseDetail = `${required.table}: ${error instanceof Error ? error.message : String(error)}`;
      break;
    }
  }

  let oauthStateReady = true;
  let oauthStateDetail: string | null = null;
  try {
    const { error } = await supabaseAdmin.from("oauth_states").select(OAUTH_STATE_COLUMNS).limit(0);
    if (error) {
      oauthStateReady = false;
      oauthStateDetail = `oauth_states (${OAUTH_STATE_COLUMNS}): ${error.message}`;
    }
  } catch (error) {
    oauthStateReady = false;
    oauthStateDetail = `oauth_states: ${error instanceof Error ? error.message : String(error)}`;
  }

  try {
    let query = supabaseAdmin
      .from("audit_log")
      .select("entity_id, details, created_at")
      .eq("action", "provider.credential_test");
    if (ctx.tenantId) query = query.eq("tenant_id", ctx.tenantId);
    const { data } = await query.order("created_at", { ascending: false }).limit(60);
    for (const row of data ?? []) {
      const id = row.entity_id;
      if (!id || credentialTests.has(id)) continue;
      const details = (row.details ?? null) as { status?: unknown } | null;
      credentialTests.set(id, {
        at: row.created_at,
        status: typeof details?.status === "string" ? details.status : "unknown",
      });
    }
  } catch {
    /* an unreadable audit log must not block a diagnosis */
  }

  return {
    serviceRoleConfigured: true,
    databaseReady,
    databaseDetail,
    oauthStateReady,
    oauthStateDetail,
    encryption,
    credentialTests,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluation
// ─────────────────────────────────────────────────────────────────────────────

/** Connector ids this provider family serves, from the catalogue. */
export function connectorsForProvider(provider: OAuthProviderId): string[] {
  return CONNECTORS.filter((c) => c.oauth && c.provider === provider).map((c) => String(c.id));
}

/** Whether any capability of this provider's connectors is gated behind app review. */
function reviewFacts(provider: OAuthProviderId): { required: boolean; detail: string } {
  const gated: string[] = [];
  for (const id of connectorsForProvider(provider)) {
    const definition = connectorDefinition(id);
    if (!definition) continue;
    for (const [key, facts] of Object.entries(definition.capabilities)) {
      if (facts.reviewRequired) gated.push(`${id}.${key}`);
    }
  }
  return {
    required: gated.length > 0,
    detail: gated.length ? `Review-gated capabilities: ${gated.join(", ")}.` : "",
  };
}

/** The state the collected problems add up to. Precedence is documented at the top. */
export function classifyState(
  blocking: ConnectionProblem[],
  warnings: ConnectionProblem[],
): ReadinessState {
  const codes = new Set(blocking.map((p) => p.code));
  const flasLevel = [
    "OAUTH_ORIGIN_MISSING",
    "OAUTH_ORIGIN_NOT_ALLOWED",
    "TOKEN_ENCRYPTION_KEY_INVALID",
    "DATABASE_MIGRATION_PENDING",
    "OAUTH_STATE_UNAVAILABLE",
    "SERVICE_ROLE_MISSING",
    "FLAS_CONFIGURATION_ERROR",
    "CONNECTOR_UNAVAILABLE",
  ];
  if (flasLevel.some((code) => codes.has(code))) return "FLAS_CONFIGURATION_ERROR";
  if (codes.has("PROVIDER_APP_ID_MISSING") || codes.has("PROVIDER_APP_SECRET_MISSING")) {
    return "NEEDS_CONFIGURATION";
  }
  if (blocking.length) return "FLAS_CONFIGURATION_ERROR";
  const warningCodes = new Set(warnings.map((p) => p.code));
  if (warningCodes.has("CREDENTIAL_TEST_FAILED")) return "NEEDS_PROVIDER_CONFIGURATION";
  if (warningCodes.has("PROVIDER_ERROR")) return "PROVIDER_ERROR";
  if (warningCodes.has("PROVIDER_REVIEW_REQUIRED")) return "NEEDS_PROVIDER_REVIEW";
  return "READY";
}

/**
 * Everything known about one provider's setup.
 *
 * Never throws: an unexpected failure in any check becomes a blocking problem
 * on the returned record instead, so the other providers still render.
 */
export async function evaluateProviderReadiness(
  provider: OAuthProviderId,
  ctx: ReadinessContext,
  shared?: ReadinessProbes,
): Promise<ProviderReadiness> {
  const probes = shared ?? (await probeDeployment(ctx));
  const name = PROVIDER_NAMES[provider];
  const blocking: ConnectionProblem[] = [];
  const warnings: ConnectionProblem[] = [];

  const providerConfigPresent = Object.prototype.hasOwnProperty.call(PROVIDERS, provider);
  if (!providerConfigPresent) {
    blocking.push(
      internalProblem("provider configuration", `${provider} is not a known provider.`),
    );
  }

  // ── Return address. The browser's origin is validated exactly as startConnect
  // validates it; when there is no caller origin the configured address is
  // diagnosed instead. Nothing here widens the allowlist.
  const configured = configuredAllowedOrigins();
  const allowedOriginConfigured = configured.length > 0;
  const publicAppUrlConfigured = Boolean((process.env["PUBLIC_APP_URL"] ?? "").trim());
  const candidate = ctx.origin ?? process.env["PUBLIC_APP_URL"] ?? null;
  const validatedOrigin = candidate ? resolveAllowedOrigin(candidate) : null;
  if (!allowedOriginConfigured || !validatedOrigin) {
    blocking.push(originProblem(candidate));
  } else if (!publicAppUrlConfigured) {
    warnings.push(publicAppUrlProblem());
  }
  const redirectUri = validatedOrigin ? oauthRedirectUri(validatedOrigin) : null;

  // ── Credentials. Presence only: the secret is never returned or logged.
  let appIdPresent = false;
  let appIdMasked: string | null = null;
  let secretPresent = false;
  let credentialSource: ProviderReadiness["credentialSource"] = "none";
  if (providerConfigPresent) {
    try {
      const creds = await resolveCredentials(provider, ctx.tenantId);
      appIdPresent = Boolean(creds.id);
      appIdMasked = maskId(creds.id);
      secretPresent = Boolean(creds.secret);
      credentialSource = appIdPresent && secretPresent ? creds.source : "none";
      if (!appIdPresent) {
        blocking.push(
          await credentialProblem({
            provider,
            tenantId: ctx.tenantId,
            missing: "id",
            redirectUri,
          }),
        );
      }
      if (!secretPresent) {
        blocking.push(
          await credentialProblem({
            provider,
            tenantId: ctx.tenantId,
            missing: "secret",
            redirectUri,
          }),
        );
      }
    } catch (error) {
      blocking.push(internalProblem("app keys", error));
    }
  }

  // ── Encryption, database, state table: measured once for the whole deployment.
  if (probes.encryption.keysPresent && !probes.encryption.configured) {
    blocking.push(encryptionProblem("invalid", probes.encryption.detail));
  } else if (!probes.encryption.keysPresent) {
    warnings.push(encryptionProblem("absent", null));
  }
  if (!probes.serviceRoleConfigured) {
    blocking.push(serviceRoleProblem());
  } else {
    if (!probes.databaseReady) blocking.push(migrationProblem(probes.databaseDetail));
    if (!probes.oauthStateReady) blocking.push(oauthStateWriteProblem(probes.oauthStateDetail));
  }

  // ── Provider review.
  const review = providerConfigPresent ? reviewFacts(provider) : { required: false, detail: "" };
  if (review.required) warnings.push(reviewProblem(provider, review.detail));

  // ── Last recorded credential test.
  const recorded = probes.credentialTests.get(provider) ?? null;
  const lastCredentialTest = recorded?.at ?? null;
  const lastCredentialTestStatus: ProviderReadiness["lastCredentialTestStatus"] =
    recorded?.status === "passed" ? "passed" : recorded?.status === "failed" ? "failed" : "never";
  if (lastCredentialTestStatus === "failed" && appIdPresent && secretPresent) {
    warnings.push(credentialTestFailedProblem(provider, credentialSource, lastCredentialTest));
  }

  const nextActions: string[] = [];
  for (const problem of [...blocking, ...warnings]) {
    if (!nextActions.includes(problem.nextAction)) nextActions.push(problem.nextAction);
  }

  return {
    provider,
    name,
    state: classifyState(blocking, warnings),
    configured: appIdPresent && secretPresent,
    credentialSource,
    appIdPresent,
    appIdMasked,
    secretPresent,
    allowedOriginConfigured,
    publicAppUrlConfigured,
    redirectUri,
    encryptionConfigured: probes.encryption.configured,
    databaseReady: probes.serviceRoleConfigured && probes.databaseReady,
    oauthStateReady: probes.serviceRoleConfigured && probes.oauthStateReady,
    providerConfigPresent,
    reviewRequired: review.required,
    reviewStatus: review.required ? "unknown" : "not_required",
    lastCredentialTest,
    lastCredentialTestStatus,
    connectors: connectorsForProvider(provider),
    blockingIssues: blocking,
    warnings,
    nextActions,
  };
}

/** Every provider. One provider failing never removes the others from the list. */
export async function evaluateAllProviders(ctx: ReadinessContext): Promise<ProviderReadiness[]> {
  let probes: ReadinessProbes;
  try {
    probes = await probeDeployment(ctx);
  } catch (error) {
    // Even the shared probe failing leaves every provider reportable.
    probes = {
      serviceRoleConfigured: false,
      databaseReady: false,
      databaseDetail: redactSecrets(error instanceof Error ? error.message : String(error)),
      oauthStateReady: false,
      oauthStateDetail: null,
      encryption: { configured: false, keysPresent: false, detail: null },
      credentialTests: new Map(),
    };
  }

  const results = await Promise.all(
    READINESS_PROVIDERS.map(async (provider) => {
      try {
        return await evaluateProviderReadiness(provider, ctx, probes);
      } catch (error) {
        return unreadableProvider(provider, error);
      }
    }),
  );
  return results;
}

/** The record for a provider whose evaluation itself failed. */
function unreadableProvider(provider: OAuthProviderId, error: unknown): ProviderReadiness {
  const problem = internalProblem("readiness", error);
  return {
    provider,
    name: PROVIDER_NAMES[provider],
    state: "FLAS_CONFIGURATION_ERROR",
    configured: false,
    credentialSource: "none",
    appIdPresent: false,
    appIdMasked: null,
    secretPresent: false,
    allowedOriginConfigured: configuredAllowedOrigins().length > 0,
    publicAppUrlConfigured: Boolean((process.env["PUBLIC_APP_URL"] ?? "").trim()),
    redirectUri: null,
    encryptionConfigured: false,
    databaseReady: false,
    oauthStateReady: false,
    providerConfigPresent: Object.prototype.hasOwnProperty.call(PROVIDERS, provider),
    reviewRequired: false,
    reviewStatus: "unknown",
    lastCredentialTest: null,
    lastCredentialTestStatus: "never",
    connectors: connectorsForProvider(provider),
    blockingIssues: [problem],
    warnings: [],
    nextActions: [problem.nextAction],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Audience and role policy. Pure, so the rules are covered by tests rather than
// only by whichever screen happens to call them.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which version of a problem this caller may see.
 *
 * A Flas super admin sees everything. A workspace admin is an administrator
 * only of their own workspace's problems; a Flas deployment problem is not
 * theirs to fix, so they are told what everyone else is told. Everyone else is
 * always a user.
 */
export function audienceFor(owner: ProblemOwner, role: CallerRole): Audience {
  if (role.superAdmin) return "admin";
  if (role.workspaceAdmin && owner === "WORKSPACE_ADMIN") return "admin";
  return "user";
}

/** One problem, as this caller should see it. */
export function problemForCaller(problem: ConnectionProblem, role: CallerRole): ConnectionProblem {
  return forAudience(problem, audienceFor(problem.owner, role));
}

/** One readiness record with every problem filtered for the caller. */
export function readinessForCaller(
  readiness: ProviderReadiness,
  role: CallerRole,
): ProviderReadiness {
  const blockingIssues = readiness.blockingIssues.map((p) => problemForCaller(p, role));
  const warnings = readiness.warnings.map((p) => problemForCaller(p, role));
  // Rebuilt from the filtered problems rather than copied. nextActions carries
  // the owner's own wording -- "Set OAUTH_ALLOWED_ORIGINS ... and redeploy" --
  // so copying it through would have handed a server setting name to exactly
  // the readers the filtering above just protected.
  const nextActions: string[] = [];
  for (const problem of [...blockingIssues, ...warnings]) {
    if (!nextActions.includes(problem.nextAction)) nextActions.push(problem.nextAction);
  }
  return { ...readiness, blockingIssues, warnings, nextActions };
}

/** The single problem worth showing on a card: the first blocker, else the first warning. */
export function primaryProblem(readiness: ProviderReadiness): ConnectionProblem | null {
  return readiness.blockingIssues[0] ?? readiness.warnings[0] ?? null;
}

/** What a non-administrator is told: can I connect, and if not, why. */
export function availabilityForCaller(
  readiness: ProviderReadiness,
  role: CallerRole,
): ProviderAvailability {
  const problem = primaryProblem(readiness);
  return {
    provider: readiness.provider,
    name: readiness.name,
    state: readiness.state,
    available: readiness.blockingIssues.length === 0,
    problem: problem ? problemForCaller(problem, role) : null,
  };
}

/** Only a Flas super admin ever sees server setting names. */
export function visibleMissingSettings(missing: string[], role: CallerRole): string[] {
  return role.superAdmin ? missing : [];
}

/** Who may open the diagnosis view at all. */
export function canViewProviderReadiness(role: CallerRole): boolean {
  return role.superAdmin || role.workspaceAdmin;
}

export const READINESS_REFUSAL =
  "Connection diagnostics are only available to Flas administrators and workspace admins.";

/**
 * Who may ask a provider to check app keys.
 *
 * A super admin may test anything. A workspace admin may test only an app their
 * own workspace supplied -- testing the shared Flas app would let any customer
 * probe a credential they do not own.
 */
export function canTestCredentials(
  role: CallerRole,
  source: "workspace" | "shared" | "none",
): boolean {
  if (role.superAdmin) return true;
  return role.workspaceAdmin && source === "workspace";
}

export const CREDENTIAL_TEST_REFUSAL =
  "Only a Flas administrator can test these app keys. A workspace admin can test their own workspace's app keys.";

/**
 * One credential test per provider per 30 seconds.
 *
 * In-memory and per server process: it exists to stop a screen hammering a
 * provider's token endpoint, not as a security control, and it resets on
 * deploy and is not shared between instances.
 */
const CREDENTIAL_TEST_INTERVAL_MS = 30_000;
const lastCredentialTestAt = new Map<string, number>();

export function checkCredentialTestRateLimit(
  provider: OAuthProviderId,
  now: number = Date.now(),
): { allowed: boolean; retryAfterSeconds: number } {
  const previous = lastCredentialTestAt.get(provider);
  if (previous !== undefined && now - previous < CREDENTIAL_TEST_INTERVAL_MS) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((CREDENTIAL_TEST_INTERVAL_MS - (now - previous)) / 1000),
    };
  }
  lastCredentialTestAt.set(provider, now);
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Test-only: forget the rate-limit window. */
export function resetCredentialTestRateLimit(): void {
  lastCredentialTestAt.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// startConnect's result, shaped for the caller
// ─────────────────────────────────────────────────────────────────────────────

export type StartConnectResult =
  | { ready: true; url: string; attemptId: string }
  | { ready: false; reason: string; missing: string[]; problem: ConnectionProblem };

/**
 * A blocked Connect click as this caller should see it: the problem filtered for
 * their audience, the reason taken from that filtered problem so the two can
 * never disagree, and server setting names only for a Flas super admin.
 */
export function startResultForCaller(
  result: { ready: false; reason: string; missing: string[]; problem: ConnectionProblem },
  role: CallerRole,
): { ready: false; reason: string; missing: string[]; problem: ConnectionProblem } {
  const problem = problemForCaller(result.problem, role);
  return {
    ready: false,
    reason: problem.message,
    missing: visibleMissingSettings(result.missing, role),
    problem,
  };
}
