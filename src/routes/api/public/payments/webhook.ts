// Payments webhook — keeps the subscriptions table and each company's
// organizations.subscription_status in sync. Signature-verified; public by design.
import { createFileRoute } from "@tanstack/react-router";
import { verifyWebhook, EventName, type PaddleEnv } from "@/lib/paddle.server";

/* eslint-disable @typescript-eslint/no-explicit-any */

type OrgSync = {
  tenantId?: string | undefined;
  status: string;
  /** The plan bought, as its price id: flash_monthly or flash_yearly. */
  plan?: string | undefined;
  periodEnd?: string | null;
  customerId?: string;
  subscriptionId?: string;
};

/**
 * Paddle delivers an event again until it gets a 2xx. A failed write must fail
 * the delivery: answering 200 told Paddle the payment was recorded, so a
 * company that paid could stay unactivated with nothing left to retry. Every
 * write below sets state rather than adding to it, so applying a redelivered
 * event again is harmless.
 */
function mustSucceed(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`Could not ${what}: ${error.message}`);
}

/**
 * Paddle does not promise delivery order, so a change can arrive before the
 * subscription.created that records the subscription. Failing it makes Paddle
 * deliver it again after that has been processed, instead of dropping the
 * change. Only for a subscription started from FLAS checkout (it carries our
 * userId) and created recently: an old one FLAS never recorded will not
 * appear by waiting.
 */
function awaitingCreation(data: any): boolean {
  const createdAt = Date.parse(data?.createdAt ?? "");
  return Boolean(data?.customData?.userId) && Date.now() - createdAt < 60 * 60 * 1000;
}

async function syncOrganization(sync: OrgSync) {
  const tenantId = sync.tenantId;
  if (!tenantId) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const patch: {
    paddle_customer_id?: string;
    paddle_subscription_id?: string;
    subscription_status?: string;
    suspended?: boolean;
    subscription_renews_at?: string;
    plan?: string;
  } = {};
  if (sync.customerId) patch.paddle_customer_id = sync.customerId;
  if (sync.subscriptionId) patch.paddle_subscription_id = sync.subscriptionId;
  // The plan was never written here, so a company that bought a year still
  // showed the monthly plan it was created with.
  if (sync.plan) patch.plan = sync.plan;
  if (sync.status === "active" || sync.status === "trialing") {
    patch.subscription_status = sync.status === "trialing" ? "trial" : "active";
    patch.suspended = false;
  } else if (sync.status === "past_due") {
    patch.subscription_status = "past_due";
  } else if (sync.status === "canceled") {
    patch.subscription_status = "canceled";
    patch.suspended = true;
  }
  if (sync.periodEnd) patch.subscription_renews_at = sync.periodEnd;
  const { error } = await supabaseAdmin.from("organizations").update(patch).eq("id", tenantId);
  mustSucceed(error, "update the company's subscription");

  const { logAudit } = await import("@/lib/audit.server");
  await logAudit({
    action: "billing.subscription_sync",
    tenantId,
    actorLabel: "payments-webhook",
    entityType: "organization",
    entityId: tenantId,
    details: { status: sync.status, periodEnd: sync.periodEnd ?? null },
  });
}

async function handleSubscriptionCreated(data: any, env: PaddleEnv) {
  const { id, customerId, items, status, currentBillingPeriod, customData } = data;
  const userId = customData?.userId;
  if (!userId) {
    console.error("No userId in customData");
    return;
  }
  const item = items[0];
  const priceId = item.price.importMeta?.externalId;
  const productId = item.product.importMeta?.externalId;
  if (!priceId || !productId) {
    console.warn("Skipping subscription: missing importMeta.externalId", {
      rawPriceId: item.price.id,
      rawProductId: item.product.id,
    });
    return;
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error: saveError } = await supabaseAdmin.from("subscriptions").upsert(
    {
      user_id: userId,
      paddle_subscription_id: id,
      paddle_customer_id: customerId,
      product_id: productId,
      price_id: priceId,
      status,
      current_period_start: currentBillingPeriod?.startsAt,
      current_period_end: currentBillingPeriod?.endsAt,
      environment: env,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "paddle_subscription_id" },
  );
  mustSucceed(saveError, "save the subscription");

  // Derive the tenant from the subscriber's own profile server-side, never
  // from customData.tenantId directly — customData is set client-side when
  // checkout starts (BillingCard.tsx), so a caller could point a paid
  // checkout at an arbitrary tenantId and have this handler apply someone
  // else's subscription status to their organization. userId is used only
  // to look up the real tenant; the client-supplied tenantId is ignored.
  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();
  // A failed lookup used to read as "no company", so the payment was
  // acknowledged and never applied.
  mustSucceed(profileError, "find the subscriber's company");

  await syncOrganization({
    tenantId: profile?.tenant_id ?? undefined,
    status,
    periodEnd: currentBillingPeriod?.endsAt ?? null,
    customerId,
    subscriptionId: id,
    plan: priceId,
  });
}

async function handleSubscriptionUpdated(data: any, env: PaddleEnv) {
  const { id, status, currentBillingPeriod, scheduledChange, items } = data;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: row, error } = await supabaseAdmin
    .from("subscriptions")
    .update({
      status,
      current_period_start: currentBillingPeriod?.startsAt,
      current_period_end: currentBillingPeriod?.endsAt,
      cancel_at_period_end: scheduledChange?.action === "cancel",
      updated_at: new Date().toISOString(),
    })
    .eq("paddle_subscription_id", id)
    .eq("environment", env)
    .select("user_id")
    .maybeSingle();
  mustSucceed(error, "update the subscription");
  if (!row && awaitingCreation(data)) throw new Error(`Subscription ${id} is not recorded yet`);

  // Mirror onto the company row via the subscriber's profile tenant.
  if (row?.user_id) {
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id")
      .eq("id", row.user_id)
      .maybeSingle();
    mustSucceed(profileError, "find the subscriber's company");
    await syncOrganization({
      tenantId: profile?.tenant_id ?? undefined,
      status,
      periodEnd: currentBillingPeriod?.endsAt ?? null,
      subscriptionId: id,
      plan: items?.[0]?.price?.importMeta?.externalId ?? undefined,
    });
  }
}

async function handleSubscriptionCanceled(data: any, env: PaddleEnv) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: row, error } = await supabaseAdmin
    .from("subscriptions")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("paddle_subscription_id", data.id)
    .eq("environment", env)
    .select("user_id")
    .maybeSingle();
  mustSucceed(error, "cancel the subscription");
  if (!row && awaitingCreation(data))
    throw new Error(`Subscription ${data.id} is not recorded yet`);

  if (row?.user_id) {
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id")
      .eq("id", row.user_id)
      .maybeSingle();
    mustSucceed(profileError, "find the subscriber's company");
    await syncOrganization({
      tenantId: profile?.tenant_id ?? undefined,
      status: "canceled",
      subscriptionId: data.id,
    });
  }
}

async function handlePaymentFailed(data: any) {
  // Dunning: keep access while the provider retries, but flag the company and alert the manager.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const subscriptionId = data.subscriptionId ?? data.subscription_id;
  if (!subscriptionId) return;
  const { data: row, error } = await supabaseAdmin
    .from("subscriptions")
    .select("user_id")
    .eq("paddle_subscription_id", subscriptionId)
    .maybeSingle();
  mustSucceed(error, "find the subscription");
  if (!row?.user_id) return;
  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("tenant_id")
    .eq("id", row.user_id)
    .maybeSingle();
  mustSucceed(profileError, "find the subscriber's company");
  if (profile?.tenant_id) {
    const { error: updateError } = await supabaseAdmin
      .from("organizations")
      .update({ subscription_status: "past_due" })
      .eq("id", profile.tenant_id);
    mustSucceed(updateError, "mark the company past due");
  }
  const { raiseAlert } = await import("@/lib/monitoring.server");
  await raiseAlert({
    title: "Subscription payment failed",
    message: "A company's renewal payment failed — retries are running automatically.",
    severity: "critical",
    source: "billing",
  });
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (request.headers.get("stripe-signature")) {
          const { handleStripeWebhook } = await import("@/lib/stripe.server");
          return await handleStripeWebhook(request);
        }

        // Anchor env to a server-side env var, never the URL. A query string
        // is attacker-controlled — hitting `?env=sandbox` on the prod URL
        // used to force verification against the sandbox secret, and if that
        // secret ever leaked, sandbox test events could mutate prod data.
        const env = (
          (process.env["PADDLE_ENV"] ?? "sandbox").toLowerCase() === "live" ? "live" : "sandbox"
        ) as PaddleEnv;
        let event: Awaited<ReturnType<typeof verifyWebhook>>;
        try {
          event = await verifyWebhook(request, env);
        } catch (e) {
          console.error("Webhook error:", e);
          return new Response("Webhook error", { status: 400 });
        }
        try {
          switch (event.eventType) {
            case EventName.SubscriptionCreated:
              await handleSubscriptionCreated(event.data, env);
              break;
            case EventName.SubscriptionUpdated:
              await handleSubscriptionUpdated(event.data, env);
              break;
            case EventName.SubscriptionCanceled:
              await handleSubscriptionCanceled(event.data, env);
              break;
            case EventName.TransactionPaymentFailed:
              await handlePaymentFailed(event.data);
              break;
            default:
              console.log("Unhandled event:", event.eventType);
          }
          return Response.json({ received: true });
        } catch (e) {
          // Not acknowledged, so Paddle delivers the event again.
          console.error("Payment event could not be recorded:", e);
          try {
            const { raiseAlert } = await import("@/lib/monitoring.server");
            await raiseAlert({
              title: "Payment event could not be recorded",
              message: `${event.eventType}: Paddle will deliver it again. ${e instanceof Error ? e.message : ""}`,
              severity: "critical",
              source: "billing",
            });
          } catch {
            // The retry still happens; the alert is only a courtesy.
          }
          return new Response("Webhook processing failed", { status: 500 });
        }
      },
    },
  },
});
