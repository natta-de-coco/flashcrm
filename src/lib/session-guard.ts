// Global server-function guard.
//
// Client side: makes sure a live Supabase session exists (refreshing it when the
// access token has lapsed) before any RPC leaves the browser, and turns every
// "Unauthorized" answer into a friendly message plus a redirect to /auth —
// instead of the blank screen a thrown runtime error used to produce.
//
// Server side: logs exactly why a call was accepted or rejected (authorization
// header present? token shaped like a JWT? which user id?) so a missing token is
// traceable in the server logs.
import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

const FRIENDLY = "Your session has expired. Please sign in again to continue.";

function isUnauthorized(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /unauthorized|jwt|invalid token|no authorization header/i.test(message);
}

/** Best-effort `sub` claim for logging only — never used for authorization. */
function peekSubject(token: string): string {
  try {
    const part = token.split(".")[1];
    if (!part) return "unknown";
    const json = JSON.parse(
      atob(part.replace(/-/g, "+").replace(/_/g, "/")),
    ) as { sub?: string };
    return json.sub ?? "unknown";
  } catch {
    return "unparseable";
  }
}

export const sessionGuard = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    if (typeof window !== "undefined") {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        // A stored-but-expired token can usually be refreshed silently.
        await supabase.auth.refreshSession().catch(() => undefined);
      }
    }

    try {
      return await next();
    } catch (error) {
      if (typeof window !== "undefined" && isUnauthorized(error)) {
        const { supabase } = await import("@/integrations/supabase/client");
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          const { toast } = await import("sonner");
          toast.error(FRIENDLY);
          const here = `${window.location.pathname}${window.location.search}`;
          if (!window.location.pathname.startsWith("/auth")) {
            window.location.assign(`/auth?redirect=${encodeURIComponent(here)}`);
          }
          throw new Error(FRIENDLY);
        }
      }
      throw error;
    }
  })
  .server(async ({ next }) => {
    const request = getRequest();
    const label = request?.url ? new URL(request.url).pathname : "serverFn";
    const authHeader = request?.headers?.get("authorization") ?? null;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const shape = !token ? "missing" : token.split(".").length === 3 ? "jwt" : "opaque";
    const subject = shape === "jwt" ? peekSubject(token) : "none";

    console.info(
      `[serverFn] ${label} auth_header=${authHeader ? "present" : "absent"} token=${shape} user=${subject}`,
    );

    try {
      const result = await next();
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isUnauthorized(error)) {
        console.warn(
          `[serverFn] ${label} rejected: ${message} (auth_header=${authHeader ? "present" : "absent"}, token=${shape}, user=${subject})`,
        );
        throw new Error(`Unauthorized: ${FRIENDLY}`);
      }
      console.error(`[serverFn] ${label} failed: ${message}`);
      throw error;
    }
  });
