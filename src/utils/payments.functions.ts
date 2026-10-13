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

/** Creates a Stripe Checkout Session for new subscriptions. */
export const createStripeCheckoutSessionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        plan: z.enum(["flash_monthly", "flash_yearly"]),
        origin: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: profile, error: profileErr } = await context.supabase
      .from("profiles")
      .select("tenant_id, staff_role")
      .eq("id", context.userId)
      .maybeSingle();

    if (profileErr || !profile?.tenant_id) {
      throw new Error("Could not find workspace for subscriber.");
    }

    const { isCompanyManager } = await import("@/lib/permissions");
    if (!isCompanyManager(profile.staff_role)) {
      throw new Error("Only company administrators can manage billing and checkout.");
    }

    const { data: userRes } = await context.supabase.auth.getUser();
    const userEmail = userRes?.user?.email ?? null;

    const origin =
      data.origin ||
      (typeof window !== "undefined" ? window.location.origin : "https://flas.mobidigisol.com");

    const successUrl = `${origin}/settings?checkout=success&provider=stripe&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${origin}/settings?checkout=cancel`;

    const { createStripeCheckoutSession } = await import("@/lib/stripe.server");
    const session = await createStripeCheckoutSession({
      tenantId: profile.tenant_id,
      userId: context.userId,
      userEmail,
      plan: data.plan,
      successUrl,
      cancelUrl,
    });

    if (!session.url) {
      throw new Error("Stripe did not return a checkout URL.");
    }

    return { url: session.url, sessionId: session.id };
  });

/** Opens the hosted customer portal (Stripe or Paddle) so companies can manage payment. */
export const createPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("tenant_id, staff_role")
      .eq("id", context.userId)
      .maybeSingle();

    if (!profile?.tenant_id) {
      throw new Error("No organization found for this account.");
    }

    const { isCompanyManager } = await import("@/lib/permissions");
    if (!isCompanyManager(profile.staff_role)) {
      throw new Error("Only company administrators can access the billing portal.");
    }

    const { data: org } = await context.supabase
      .from("organizations")
      .select("stripe_customer_id, paddle_customer_id, paddle_subscription_id")
      .eq("id", profile.tenant_id)
      .maybeSingle();

    // 1. If Stripe customer ID exists, open Stripe Billing Portal
    if (org?.stripe_customer_id) {
      const { createStripePortalSession } = await import("@/lib/stripe.server");
      const returnUrl =
        typeof window !== "undefined"
          ? `${window.location.origin}/settings`
          : "https://flas.mobidigisol.com/settings";
      const portal = await createStripePortalSession({
        customerId: org.stripe_customer_id,
        returnUrl,
      });
      return { url: portal.url };
    }

    // 2. Otherwise fall back to Paddle for existing Paddle subscribers
    const { data: sub } = await context.supabase
      .from("subscriptions")
      .select("paddle_customer_id, paddle_subscription_id, stripe_customer_id, environment")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sub?.stripe_customer_id) {
      const { createStripePortalSession } = await import("@/lib/stripe.server");
      const returnUrl = "https://flas.mobidigisol.com/settings";
      const portal = await createStripePortalSession({
        customerId: sub.stripe_customer_id,
        returnUrl,
      });
      return { url: portal.url };
    }

    if (!sub || !sub.paddle_customer_id || !sub.paddle_subscription_id) {
      throw new Error("No active billing subscription found for this account yet.");
    }

    const { getPaddleClient } = await import("@/lib/paddle.server");
    const paddle = getPaddleClient((sub.environment as "sandbox" | "live") || "sandbox");
    const session = await paddle.customerPortalSessions.create(sub.paddle_customer_id, [
      sub.paddle_subscription_id,
    ]);
    return { url: session.urls.general.overview };
  });

/** Disconnects Paddle for the current company so new billing runs through Stripe. */
export const disconnectPaddleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("tenant_id, staff_role")
      .eq("id", context.userId)
      .maybeSingle();

    if (!profile?.tenant_id) {
      throw new Error("No organization found.");
    }

    const { isCompanyManager } = await import("@/lib/permissions");
    if (!isCompanyManager(profile.staff_role)) {
      throw new Error("Only company administrators can manage billing providers.");
    }

    const { data: org } = await context.supabase
      .from("organizations")
      .select("id, paddle_subscription_id, paddle_customer_id")
      .eq("id", profile.tenant_id)
      .maybeSingle();

    // If active paddle subscription exists, cancel or schedule cancellation via SDK so it stops recurring
    if (org?.paddle_subscription_id) {
      try {
        const { data: sub } = await context.supabase
          .from("subscriptions")
          .select("environment")
          .eq("paddle_subscription_id", org.paddle_subscription_id)
          .maybeSingle();

        const env = (sub?.environment as "sandbox" | "live") || "sandbox";
        const { getPaddleClient } = await import("@/lib/paddle.server");
        const paddle = getPaddleClient(env);
        await paddle.subscriptions.cancel(org.paddle_subscription_id, {
          effectiveFrom: "next_billing_period",
        });
      } catch (cancelErr: unknown) {
        console.warn(
          "Paddle subscription cancellation note:",
          cancelErr instanceof Error ? cancelErr.message : String(cancelErr),
        );
      }
    }

    // Preserve historical paddle subscription and customer identities for audit; switch provider to stripe
    const { error } = await context.supabase
      .from("organizations")
      .update({
        billing_provider: "stripe",
      })
      .eq("id", profile.tenant_id);

    if (error) {
      throw new Error(`Could not update billing provider: ${error.message}`);
    }

    return { ok: true };
  });
