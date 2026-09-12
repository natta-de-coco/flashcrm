import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ConnectAttempt } from "@/lib/connection-problem";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * "Did that sign-in finish?" — asked by the tab that is waiting, answered by
 * the server and by nothing else.
 *
 * The waiting tab hears a BroadcastChannel ping the instant the popup closes,
 * but a ping is only ever a reason to ask this. Treating one as proof would
 * mean any page able to post on that channel could tell Flas a connection
 * succeeded.
 *
 * Returns tokens, codes and verifiers never — the underlying read does not even
 * select those columns.
 */
export const getConnectAttempt = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ attemptId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<ConnectAttempt> => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("tenant_id, staff_role")
      .eq("id", context.userId)
      .maybeSingle();

    const { isCompanyManager } = await import("@/lib/permissions");
    const { readConnectAttempt } = await import("@/lib/connect-attempts.server");

    // The callback address is derived, never stored per attempt, so a
    // redirect-mismatch problem can print the exact value to register.
    const origin = (process.env["PUBLIC_APP_URL"] ?? "").split(",")[0]?.trim().replace(/\/$/, "");

    const attempt = await readConnectAttempt({
      attemptId: data.attemptId,
      tenantId: profile?.tenant_id ?? null,
      userId: context.userId,
      audience: isCompanyManager(profile?.staff_role) ? "admin" : "user",
      ...(origin ? { redirectUri: `${origin}/api/public/oauth-callback` } : {}),
    });

    // Not found, another workspace's, and another person's all answer the same
    // way on purpose: a caller who can tell them apart can enumerate activity
    // that is none of their business.
    if (!attempt) throw new Error("That connection attempt was not found.");
    return attempt;
  });
