// Global server-function guard.
//
// Client side: makes sure a live Supabase session exists (refreshing it when the
// access token has lapsed) before any RPC leaves the browser, and turns every
// "Unauthorized" answer into a friendly message plus a redirect to /auth —
// instead of the blank screen a thrown runtime error used to produce. It also
// turns the server's two-factor refusals into sentences in the person's language.
//
// Server side: logs exactly why a call was accepted or rejected (authorization
// header present? token shaped like a JWT? which user id?) so a missing token is
// traceable in the server logs. It also refuses a session that has only given
// its password when the account has two-factor (see lib/two-factor.server.ts).
import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { languageFromCookieHeader, translate, type MessageKey } from "@/lib/i18n";
import {
  isTwoFactorRequired,
  isTwoFactorUnchecked,
  sessionOwesSecondFactor,
} from "@/lib/two-factor";

const FRIENDLY = "Your session has expired. Please sign in again to continue.";

function isUnauthorized(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /unauthorized|jwt|invalid token|no authorization header/i.test(message);
}

/** A sentence in the language the person chose (the language cookie), outside React. */
function inTheirLanguage(key: MessageKey): string {
  return translate(languageFromCookieHeader(document.cookie), key);
}

/** Best-effort `sub` claim for logging only — never used for authorization. */
function peekSubject(token: string): string {
  try {
    const part = token.split(".")[1];
    if (!part) return "unknown";
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as { sub?: string };
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
      if (typeof window !== "undefined" && isTwoFactorRequired(error)) {
        // The server knows the account has two-factor and this session has not
        // given its code. Usually this browser knows too and the screens have
        // already sent the person to the prompt. When it does not (the factor
        // was switched on from another device and this browser's copy of the
        // user predates it), a refresh brings the current list of factors,
        // which sends the open page to the prompt. If it already knows, do not
        // refresh again: there is nothing new to learn.
        const { supabase } = await import("@/integrations/supabase/client");
        const { data } = await supabase.auth.getSession();
        if (!sessionOwesSecondFactor(data.session)) {
          await supabase.auth.refreshSession().catch(() => undefined);
        }
        throw new Error(inTheirLanguage("auth.mfaIntro"));
      }
      if (typeof window !== "undefined" && isTwoFactorUnchecked(error)) {
        // Nothing is wrong with the session; the check just could not be made.
        throw new Error(inTheirLanguage("auth.mfaUnchecked"));
      }
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
  .server(async ({ next, serverFnMeta }) => {
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
      // Before the function's own middleware: a session that still owes its
      // code never reaches requireSupabaseAuth, let alone a handler.
      const { enforceSecondFactor } = await import("@/lib/two-factor.server");
      await enforceSecondFactor({ request, serverFnMeta });
      const result = await next();
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isTwoFactorRequired(error) || isTwoFactorUnchecked(error)) {
        // An expected answer, not a failure: say so, and say whose call it was.
        console.warn(`[serverFn] ${label} refused: ${message} (user=${subject})`);
        throw error;
      }
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
