import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { sessionGuard } from "@/lib/session-guard";

const errorMiddleware = createMiddleware().server(async ({ next, request }) => {
  // Lovable email/webhook routes authenticate themselves — never wrap or redirect them.
  if (request && new URL(request.url).pathname.startsWith("/lovable/")) {
    return next();
  }
  try {
    return await next();

  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    // Persist the incident with request context so it shows up in monitoring.
    try {
      const { recordErrorEvent, identifyBearer } = await import("@/lib/telemetry.server");
      const who = await identifyBearer(request?.headers.get("authorization"));
      await recordErrorEvent({
        kind: "server_action",
        severity: "error",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? (error.stack ?? null) : null,
        url: request?.url ?? null,
        route: request ? new URL(request.url).pathname : null,
        userAgent: request?.headers.get("user-agent") ?? null,
        tenantId: who.tenantId,
        userId: who.userId,
        userEmail: who.email,
      });
    } catch {
      /* monitoring must never mask the original failure */
    }
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth, sessionGuard],
  requestMiddleware: [errorMiddleware, csrfMiddleware],
}));
