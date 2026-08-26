import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { buildDailyBrief } from "./brief.server";

/** Flash AI daily brief for the caller's tenant — headline, summary, 3 actions. */
export const getDailyBrief = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return buildDailyBrief(context.supabase);
  });
