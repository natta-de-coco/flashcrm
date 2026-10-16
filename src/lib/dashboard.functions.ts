import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { getDashboardOverviewData } from "./dashboard.server";
import { requireDashboardAccess } from "./dashboard-access.server";

/**
 * Dashboard overview endpoint: inbox stats, 7-day activity buckets,
 * social pulse aggregates and recent conversations — scoped to the
 * caller's tenant via RLS.
 */
export const getDashboardOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireDashboardAccess(context.supabase, context.userId);
    return getDashboardOverviewData(context.supabase);
  });
