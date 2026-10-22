import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";

/**
 * Called by the signed-in layout when a second-factor code has just been
 * verified in this browser. Writes the audit entry "Two-step sign-in was turned
 * on" if (and only if) a factor really was turned on a moment ago; see
 * lib/two-factor-audit.server.ts. Safe to call at any time: it checks the facts
 * with Auth and records each factor once.
 */
export const recordTwoFactorEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const token = /^Bearer (\S+)$/.exec(getRequest()?.headers.get("authorization") ?? "")?.[1];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { recordNewTwoFactor } = await import("@/lib/two-factor-audit.server");
    return recordNewTwoFactor({
      userId: context.userId,
      token,
      supabase: context.supabase,
      admin: supabaseAdmin,
    });
  });
