import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CONNECTORS } from "@/lib/connections-catalog";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type ReadinessStatus = "READY" | "ADMIN_SETUP_REQUIRED" | "LIMITED" | "COMING_SOON";

export type ReadinessBlocker = {
  code: string;
  title: string;
  userMessage: string;
  severity: "BLOCKING" | "WARNING" | "INFO";
  owner: "FLAS_ADMIN" | "WORKSPACE_ADMIN" | "END_USER" | "PROVIDER";
  technical?: string;
};

export type IntegrationReadinessRow = {
  id: string;
  name: string;
  group: string;
  provider: string | null;
  providerName: string | null;
  oauth: boolean;
  ready: boolean;
  status: ReadinessStatus;
  source: "workspace" | "shared" | "none" | "not_applicable";
  callbackUri: string | null;
  credentials: {
    idPresent: boolean;
    secretPresent: boolean;
    idLabel: string | null;
    secretLabel: string | null;
  };
  checks: {
    credentials: boolean;
    publicAppUrl: boolean;
    allowedOrigin: boolean;
    encryption: boolean;
    storage: boolean;
  };
  blockers: ReadinessBlocker[];
  /**
   * Who has to act before this can connect: "flas" for FLAS's shared provider
   * apps and server setup, "workspace" for a step the company takes itself.
   * Null when nothing is blocking.
   */
  setupOwner: "flas" | "workspace" | null;
  /** Safe technical key names, for FLAS staff only. Empty for everyone else. */
  missing: string[];
};

const ProviderNames: Record<string, string> = {
  meta: "Meta",
  google: "Google",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  twitter: "X",
  pinterest: "Pinterest",
};

const CredentialLabels: Record<string, { id: string; secret: string }> = {
  meta: { id: "App ID", secret: "App Secret" },
  google: { id: "Client ID", secret: "Client Secret" },
  linkedin: { id: "Client ID", secret: "Client Secret" },
  tiktok: { id: "Client Key", secret: "Client Secret" },
  twitter: { id: "Client ID", secret: "Client Secret" },
  pinterest: { id: "App ID", secret: "App Secret" },
};

/**
 * Side-effect-free readiness. Unlike startAuthorization(), this never writes an
 * oauth_states row and never creates an audit event. It is safe to call when
 * rendering the Integrations screen.
 */
export const getIntegrationReadiness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ origin: z.string().url() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("tenant_id, staff_role")
      .eq("id", context.userId)
      .maybeSingle();

    const tenantId = profile?.tenant_id ?? null;
    const role = String(profile?.staff_role ?? "");
    // Every company connects through FLAS's shared provider apps, so those apps
    // and the server behind them are FLAS's to fix, and only FLAS staff see
    // how. Company owners used to get the same env-variable and migration
    // details, which read as "set this up yourself" -- the opposite of a
    // Continue with Facebook button. A company that brought its own provider
    // app does own that app, so its admins still see how to configure it.
    const seesPlatform = role === "super_admin";
    const isCompanyAdmin = role === "company_admin";
    const { providerEnvNames, resolveAllowedOrigin } = await import("@/lib/oauth.server");
    const { oauthPreflight, publicAppOrigin } = await import("@/lib/oauth-preflight.server");
    const publicOrigin = publicAppOrigin();
    const allowedOrigin = resolveAllowedOrigin(data.origin);

    const providerCache = new Map<
      string,
      {
        idPresent: boolean;
        secretPresent: boolean;
        source: "workspace" | "shared" | "none";
        envNames: string[];
        encryptionOk: boolean;
        credentialError: boolean;
        storageOk: boolean;
      }
    >();

    const rows: IntegrationReadinessRow[] = [];

    for (const connector of CONNECTORS) {
      const blockers: ReadinessBlocker[] = [];
      let source: IntegrationReadinessRow["source"] = "not_applicable";
      let idPresent = false;
      let secretPresent = false;
      let envNames: string[] = [];
      let credentialOk = true;
      let encryptionOk = true;
      let credentialError = false;
      let storageOk = true;

      if (connector.limitedReason)
        blockers.push({
          code: "LIMITED_CONNECTOR",
          title: "Limited features",
          userMessage: connector.limitedReason,
          severity: "WARNING",
          owner: "FLAS_ADMIN",
        });
      if (connector.unavailableReason) {
        blockers.push({
          code: "COMING_SOON",
          title: `${connector.name} is not available yet`,
          userMessage: connector.unavailableReason,
          severity: "BLOCKING",
          owner: "FLAS_ADMIN",
        });
      }

      if (connector.oauth && connector.provider) {
        let providerState = providerCache.get(connector.provider);
        if (!providerState) {
          const preflight = await oauthPreflight(connector.provider, tenantId, data.origin);
          const creds = preflight.credentials;
          envNames = providerEnvNames(connector.provider);
          idPresent = Boolean(creds.id?.trim());
          secretPresent = Boolean(creds.secret?.trim());
          providerState = {
            idPresent,
            secretPresent,
            source: idPresent && secretPresent ? creds.source : "none",
            envNames,
            encryptionOk: preflight.checks.encryption,
            credentialError: preflight.credentialError,
            storageOk: preflight.checks.storage,
          };
          providerCache.set(connector.provider, providerState);
        }
        ({ idPresent, secretPresent, source, envNames, encryptionOk, credentialError, storageOk } =
          providerState);
        if (!storageOk)
          blockers.push({
            code: "OAUTH_STORAGE_UNAVAILABLE",
            title: "OAuth storage is not ready",
            userMessage:
              "This connection is temporarily unavailable while FLAS setup is completed.",
            severity: "BLOCKING",
            owner: "FLAS_ADMIN",
            ...(seesPlatform
              ? {
                  technical:
                    "Apply the repository migrations and verify server database access, OAuth state columns and social account state columns.",
                }
              : {}),
          });
        if (!tenantId)
          blockers.push({
            code: "WORKSPACE_MISSING",
            title: "Workspace is not ready",
            userMessage: "Your workspace is still being set up.",
            severity: "BLOCKING",
            owner: "FLAS_ADMIN",
          });
        if (credentialError)
          blockers.push({
            code: "CREDENTIALS_UNREADABLE",
            title: "Provider configuration could not be read",
            userMessage: "This connection is temporarily unavailable.",
            severity: "BLOCKING",
            owner: "FLAS_ADMIN",
            ...(seesPlatform
              ? {
                  technical:
                    "Check platform_apps migration, server database access and the credential encryption keyring.",
                }
              : {}),
          });
        credentialOk = idPresent && secretPresent;
        const labels = CredentialLabels[connector.provider] ?? {
          id: "Client ID",
          secret: "Client Secret",
        };

        if (!idPresent) {
          blockers.push({
            code: "PROVIDER_ID_MISSING",
            title: `${labels.id} is missing`,
            userMessage: `FLAS is finishing setup for ${connector.name}. It will be available to connect soon.`,
            severity: "BLOCKING",
            owner: "FLAS_ADMIN",
            ...(seesPlatform && envNames[0] ? { technical: `Missing ${envNames[0]}` } : {}),
          });
        }
        if (!secretPresent) {
          blockers.push({
            code: "PROVIDER_SECRET_MISSING",
            title: `${labels.secret} is missing`,
            userMessage: `FLAS is finishing setup for ${connector.name}. It will be available to connect soon.`,
            severity: "BLOCKING",
            owner: "FLAS_ADMIN",
            ...(seesPlatform && envNames[1] ? { technical: `Missing ${envNames[1]}` } : {}),
          });
        }
        if (!publicOrigin) {
          blockers.push({
            code: "PUBLIC_APP_URL_MISSING",
            title: "FLAS public address is not configured",
            userMessage:
              "This connection is temporarily unavailable while FLAS setup is completed.",
            severity: "BLOCKING",
            owner: "FLAS_ADMIN",
            ...(seesPlatform
              ? { technical: "Set PUBLIC_APP_URL to the deployed HTTPS origin." }
              : {}),
          });
        }
        if (!allowedOrigin) {
          blockers.push({
            code: "OAUTH_ORIGIN_MISSING",
            title: "FLAS sign-in return address is not allowed",
            userMessage:
              "This connection is temporarily unavailable while FLAS setup is completed.",
            severity: "BLOCKING",
            owner: "FLAS_ADMIN",
            ...(seesPlatform
              ? {
                  technical: `Add ${new URL(data.origin).origin} to OAUTH_ALLOWED_ORIGINS and redeploy.`,
                }
              : {}),
          });
        }
        if (!encryptionOk) {
          blockers.push({
            code: "TOKEN_ENCRYPTION_MISSING",
            title: "Credential encryption is not configured",
            userMessage:
              "This connection is temporarily unavailable while secure storage is configured.",
            severity: "BLOCKING",
            owner: "FLAS_ADMIN",
            ...(seesPlatform
              ? { technical: "Configure TOKEN_ENCRYPTION_KEYS before storing provider tokens." }
              : {}),
          });
        }
        const ownsApp = isCompanyAdmin && source === "workspace";
        const appOwner = source === "workspace" ? "WORKSPACE_ADMIN" : "FLAS_ADMIN";
        if (allowedOrigin && connector.provider === "meta" && (seesPlatform || ownsApp)) {
          blockers.push({
            code: "META_DOMAIN_REGISTRATION_UNVERIFIED",
            title: "Check Meta domain registration",
            userMessage:
              source === "workspace"
                ? "Your Meta app must list the FLAS domain and sign-in return address."
                : "Meta app domain registration must be checked by a FLAS administrator.",
            severity: "INFO",
            owner: appOwner,
            technical: `In the ${source === "workspace" ? "workspace-owned" : "shared FLAS"} Meta app: Settings > Basic > App Domains: ${new URL(allowedOrigin).hostname}; Website URL: ${allowedOrigin}; Facebook Login > Settings > Valid OAuth Redirect URIs: ${allowedOrigin}/api/public/oauth-callback. Confirm these belong to the same app used by FLAS.`,
          });
        }
        if (allowedOrigin) {
          blockers.push({
            code: "REDIRECT_REGISTRATION_UNVERIFIED",
            title: "Provider redirect registration must match",
            userMessage: "The provider app must allow the FLAS callback address.",
            severity: "INFO",
            owner: appOwner,
            ...(seesPlatform || ownsApp
              ? {
                  technical: `${allowedOrigin}/api/public/oauth-callback must be registered in the provider console.`,
                }
              : {}),
          });
        }
      } else if (connector.id === "whatsapp") {
        const { count } = await context.supabase
          .from("wa_numbers")
          .select("id", { count: "exact", head: true })
          .eq("active", true);
        credentialOk = (count ?? 0) > 0;
        if (!credentialOk) {
          blockers.push({
            code: "WHATSAPP_NUMBER_MISSING",
            title: "No WhatsApp Business number is connected",
            userMessage: "Add a WhatsApp Business number to start using the inbox.",
            severity: "BLOCKING",
            owner: "WORKSPACE_ADMIN",
          });
        }
      }

      const blocking = blockers.some((b) => b.severity === "BLOCKING");
      const comingSoon = Boolean(connector.unavailableReason);
      const status: ReadinessStatus = comingSoon
        ? "COMING_SOON"
        : blocking
          ? "ADMIN_SETUP_REQUIRED"
          : blockers.some((b) => b.severity === "WARNING")
            ? "LIMITED"
            : "READY";
      const stillBlocking = blockers.filter((b) => b.severity === "BLOCKING");
      const setupOwner: IntegrationReadinessRow["setupOwner"] =
        comingSoon || stillBlocking.length === 0
          ? null
          : stillBlocking.every((b) => b.owner === "WORKSPACE_ADMIN")
            ? "workspace"
            : "flas";
      const workspaceStep = (b: ReadinessBlocker) =>
        isCompanyAdmin && b.owner === "WORKSPACE_ADMIN";

      const labels = connector.provider ? CredentialLabels[connector.provider] : undefined;
      rows.push({
        id: connector.id,
        name: connector.name,
        group: connector.group,
        provider: connector.provider ?? null,
        providerName: connector.provider
          ? (ProviderNames[connector.provider] ?? connector.provider)
          : null,
        oauth: connector.oauth,
        ready: status === "READY" || status === "LIMITED",
        status,
        source,
        callbackUri:
          (seesPlatform || (isCompanyAdmin && source === "workspace")) &&
          allowedOrigin &&
          connector.oauth
            ? `${allowedOrigin}/api/public/oauth-callback`
            : null,
        credentials: {
          idPresent,
          secretPresent,
          idLabel: labels?.id ?? null,
          secretLabel: labels?.secret ?? null,
        },
        checks: {
          credentials: connector.oauth ? credentialOk : true,
          publicAppUrl: connector.oauth ? Boolean(publicOrigin) : true,
          allowedOrigin: connector.oauth ? Boolean(allowedOrigin) : true,
          encryption: connector.oauth ? encryptionOk : true,
          storage: connector.oauth ? storageOk : true,
        },
        setupOwner,
        blockers: seesPlatform
          ? blockers
          : [
              // A company admin sees the steps that are theirs in full.
              ...blockers.filter(workspaceStep),
              ...blockers
                .filter((b) => b.severity === "BLOCKING" && !workspaceStep(b))
                .map((b) => ({
                  code: "SETUP_REQUIRED",
                  title: "Temporarily unavailable",
                  userMessage: b.userMessage,
                  severity: b.severity,
                  owner: b.owner,
                })),
            ],
        missing: seesPlatform
          ? blockers.filter((b) => b.severity !== "INFO").map((b) => b.technical ?? b.title)
          : [],
      });
    }

    return {
      rows,
      isAdmin: seesPlatform || isCompanyAdmin,
      canDiagnose: seesPlatform,
      publicOrigin: seesPlatform ? publicOrigin : null,
    };
  });
