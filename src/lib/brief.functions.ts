import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { buildDailyBrief } from "./brief.server";

/**
 * Flash AI daily brief for the caller's tenant — headline, summary, 3 actions.
 * Cached once per UTC day; pass { force: true } to regenerate.
 */
export const getDailyBrief = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { force?: boolean } | undefined) => ({ force: Boolean(input?.force) }))
  .handler(async ({ context, data }) => {
    return buildDailyBrief(context.supabase, { force: data.force });
  });
