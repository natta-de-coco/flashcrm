import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CONNECTORS } from "@/lib/connections-catalog";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type ReadinessStatus =
  | "READY"
  | "ADMIN_SETUP_REQUIRED"
  | "LIMITED"
  | "COMING_SOON";

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
  };
  blockers: ReadinessBlocker[];
  /** Safe technical key names for admins only. Empty for normal members. */
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

function validPublicAppUrl(): string | null {
  const raw = (process.env["PUBLIC_APP_URL"] ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

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
    const isAdmin = ["company_admin", "super_admin"].includes(String(profile?.staff_role ?? ""));
    const { resolveCredentials, providerEnvNames, resolveAllowedOrigin } = await import("@/lib/oauth.server");
    const { encryptionConfigured } = await import("@/lib/secret-box.server");

    const encryptionOk = await encryptionConfigured();
    const publicOrigin = validPublicAppUrl();
    const allowedOrigin = resolveAllowedOrigin(data.origin.replace(/\/$/, ""));

    const providerCache = new Map<
      string,
      {
        idPresent: boolean;
        secretPresent: boolean;
        source: "workspace" | "shared" | "none";
        envNames: string[];
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
          const creds = tenantId ? await resolveCredentials(connector.provider, tenantId) : { id: undefined, secret: undefined, source: "shared" as const };
          envNames = providerEnvNames(connector.provider);
          idPresent = Boolean(creds.id?.trim());
          secretPresent = Boolean(creds.secret?.trim());
          providerState = {
            idPresent,
            secretPresent,
            source: idPresent && secretPresent ? creds.source : "none",
            envNames,
          };
          providerCache.set(connector.provider, providerState);
        }
        ({ idPresent, secretPresent, source, envNames } = providerState);
        credentialOk = idPresent && secretPresent;
        const labels = CredentialLabels[connector.provider] ?? { id: "Client ID", secret: "Client Secret" };

        if (!idPresent) {
          blockers.push({
            code: "PROVIDER_ID_MISSING",
            title: `${labels.id} is missing`,
            userMessage: `${connector.name} is waiting for administrator setup.`,
            severity: "BLOCKING",
            owner: "WORKSPACE_ADMIN",
            ...(isAdmin && envNames[0] ? { technical: `Missing ${envNames[0]}` } : {}),
          });
        }
        if (!secretPresent) {
          blockers.push({
            code: "PROVIDER_SECRET_MISSING",
            title: `${labels.secret} is missing`,
            userMessage: `${connector.name} is waiting for administrator setup.`,
            severity: "BLOCKING",
            owner: "WORKSPACE_ADMIN",
            ...(isAdmin && envNames[1] ? { technical: `Missing ${envNames[1]}` } : {}),
          });
        }
        if (!publicOrigin) {
          blockers.push({
            code: "PUBLIC_APP_URL_MISSING",
            title: "FLAS public address is not configured",
            userMessage: "This connection is temporarily unavailable while FLAS setup is completed.",
            severity: "BLOCKING",
            owner: "FLAS_ADMIN",
            ...(isAdmin ? { technical: "Set PUBLIC_APP_URL to the deployed HTTPS origin." } : {}),
          });
        }
        if (!allowedOrigin) {
          blockers.push({
            code: "OAUTH_ORIGIN_MISSING",
            title: "FLAS sign-in return address is not allowed",
            userMessage: "This connection is temporarily unavailable while FLAS setup is completed.",
            severity: "BLOCKING",
            owner: "FLAS_ADMIN",
            ...(isAdmin
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
            userMessage: "This connection is temporarily unavailable while secure storage is configured.",
            severity: "BLOCKING",
            owner: "FLAS_ADMIN",
            ...(isAdmin ? { technical: "Configure TOKEN_ENCRYPTION_KEYS before storing provider tokens." } : {}),
          });
        }
        if (allowedOrigin) {
          blockers.push({
            code: "REDIRECT_REGISTRATION_UNVERIFIED",
            title: "Provider redirect registration must match",
            userMessage: "The provider app must allow the FLAS callback address.",
            severity: "INFO",
            owner: "WORKSPACE_ADMIN",
            ...(isAdmin
              ? { technical: `${allowedOrigin}/api/public/oauth-callback must be registered in the provider console.` }
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

      const labels = connector.provider ? CredentialLabels[connector.provider] : undefined;
      rows.push({
        id: connector.id,
        name: connector.name,
        group: connector.group,
        provider: connector.provider ?? null,
        providerName: connector.provider ? (ProviderNames[connector.provider] ?? connector.provider) : null,
        oauth: connector.oauth,
        ready: status === "READY" || status === "LIMITED",
        status,
        source,
        callbackUri: allowedOrigin && connector.oauth ? `${allowedOrigin}/api/public/oauth-callback` : null,
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
        },
        blockers,
        missing: isAdmin
          ? blockers
              .filter((b) => b.severity === "BLOCKING")
              .map((b) => b.technical ?? b.title)
          : [],
      });
    }

    return { rows, isAdmin, publicOrigin };
  });
