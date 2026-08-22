import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Resolves a human-readable price id (e.g. "flash_monthly") to the provider's internal id. */
export const resolvePaddlePrice = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({ priceId: z.string(), environment: z.enum(["sandbox", "live"]) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { gatewayFetch } = await import("@/lib/paddle.server");
    const response = await gatewayFetch(
      data.environment,
      `/prices?external_id=${encodeURIComponent(data.priceId)}`,
    );
    const result = (await response.json()) as { data?: Array<{ id: string }> };
    const price = result.data?.[0];
    if (!price) throw new Error("Price not found");
    return price.id;
  });

/** Opens the hosted customer portal so companies can cancel or update payment themselves. */
export const createPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: sub } = await context.supabase
      .from("subscriptions")
      .select("paddle_customer_id, paddle_subscription_id, environment")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sub) throw new Error("No subscription found for this account yet.");

    const { getPaddleClient } = await import("@/lib/paddle.server");
    const paddle = getPaddleClient(sub.environment as "sandbox" | "live");
    const session = await paddle.customerPortalSessions.create(sub.paddle_customer_id, [
      sub.paddle_subscription_id,
    ]);
    return { url: session.urls.general.overview };
  });
