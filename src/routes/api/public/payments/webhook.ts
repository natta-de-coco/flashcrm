// Payments webhook — keeps the subscriptions table and each company's
// organizations.subscription_status in sync. Signature-verified; public by design.
import { createFileRoute } from "@tanstack/react-router";
import { verifyWebhook, EventName, type PaddleEnv } from "@/lib/paddle.server";

/* eslint-disable @typescript-eslint/no-explicit-any */

type OrgSync = {
  tenantId?: string | undefined;
  status: string;
  periodEnd?: string | null;
  customerId?: string;
  subscriptionId?: string;
};

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
  } = {};
  if (sync.customerId) patch.paddle_customer_id = sync.customerId;
  if (sync.subscriptionId) patch.paddle_subscription_id = sync.subscriptionId;
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
  await supabaseAdmin.from("organizations").update(patch).eq("id", tenantId);

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
  await supabaseAdmin.from("subscriptions").upsert(
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

  // Derive the tenant from the subscriber's own profile server-side, never
  // from customData.tenantId directly — customData is set client-side when
  // checkout starts (BillingCard.tsx), so a caller could point a paid
  // checkout at an arbitrary tenantId and have this handler apply someone
  // else's subscription status to their organization. userId is used only
  // to look up the real tenant; the client-supplied tenantId is ignored.
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();

  await syncOrganization({
    tenantId: profile?.tenant_id ?? undefined,
    status,
    periodEnd: currentBillingPeriod?.endsAt ?? null,
    customerId,
    subscriptionId: id,
  });
}

async function handleSubscriptionUpdated(data: any, env: PaddleEnv) {
  const { id, status, currentBillingPeriod, scheduledChange } = data;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: row } = await supabaseAdmin
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

  // Mirror onto the company row via the subscriber's profile tenant.
  if (row?.user_id) {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id")
      .eq("id", row.user_id)
      .maybeSingle();
    await syncOrganization({
      tenantId: profile?.tenant_id ?? undefined,
      status,
      periodEnd: currentBillingPeriod?.endsAt ?? null,
      subscriptionId: id,
    });
  }
}

async function handleSubscriptionCanceled(data: any, env: PaddleEnv) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: row } = await supabaseAdmin
    .from("subscriptions")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("paddle_subscription_id", data.id)
    .eq("environment", env)
    .select("user_id")
    .maybeSingle();

  if (row?.user_id) {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id")
      .eq("id", row.user_id)
      .maybeSingle();
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
  const { data: row } = await supabaseAdmin
    .from("subscriptions")
    .select("user_id")
    .eq("paddle_subscription_id", subscriptionId)
    .maybeSingle();
  if (!row?.user_id) return;
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("tenant_id")
    .eq("id", row.user_id)
    .maybeSingle();
  if (profile?.tenant_id) {
    await supabaseAdmin
      .from("organizations")
      .update({ subscription_status: "past_due" })
      .eq("id", profile.tenant_id);
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
        // Anchor env to a server-side env var, never the URL. A query string
        // is attacker-controlled — hitting `?env=sandbox` on the prod URL
        // used to force verification against the sandbox secret, and if that
        // secret ever leaked, sandbox test events could mutate prod data.
        const env = (
          (process.env["PADDLE_ENV"] ?? "sandbox").toLowerCase() === "live" ? "live" : "sandbox"
        ) as PaddleEnv;
        try {
          const event = await verifyWebhook(request, env);
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
          console.error("Webhook error:", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
