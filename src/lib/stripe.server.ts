// Stripe billing service — checkout sessions, customer portal, and invoice tracking.
// Supports both live/test Stripe API and offline test fixtures.
import Stripe from "stripe";

/* eslint-disable @typescript-eslint/no-explicit-any */

export function getStripeKey(): string {
  return (
    process.env["STRIPE_SECRET_KEY"] ||
    process.env["VITE_STRIPE_SECRET_KEY"] ||
    ""
  );
}

export function getStripeWebhookSecret(): string {
  return (
    process.env["STRIPE_WEBHOOK_SECRET"] ||
    process.env["VITE_STRIPE_WEBHOOK_SECRET"] ||
    ""
  );
}

export function getStripePublishableKey(): string {
  return (
    process.env["VITE_STRIPE_PUBLISHABLE_KEY"] ||
    process.env["STRIPE_PUBLISHABLE_KEY"] ||
    ""
  );
}

let stripeInstance: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (globalThis.__mockStripe) {
    return globalThis.__mockStripe as unknown as Stripe;
  }
  const key = getStripeKey();
  if (!key) {
    throw new Error(
      "Stripe secret key is not configured. Please set STRIPE_SECRET_KEY in your environment.",
    );
  }
  if (!stripeInstance) {
    stripeInstance = new Stripe(key, {
      apiVersion: "2025-02-24.acacia" as any,
    });
  }
  return stripeInstance;
}

export function resolveStripeLineItem(plan: string): Stripe.Checkout.SessionCreateParams.LineItem {
  const isYearly = plan === "flash_yearly";
  const envPrice = isYearly
    ? process.env["STRIPE_PRICE_YEARLY"]
    : process.env["STRIPE_PRICE_MONTHLY"];

  if (envPrice) {
    return {
      price: envPrice,
      quantity: 1,
    };
  }

  return {
    price_data: {
      currency: "usd",
      unit_amount: isYearly ? 49000 : 4900,
      recurring: {
        interval: isYearly ? "year" : "month",
      },
      product_data: {
        name: isYearly ? "Flas CRM — Yearly Plan" : "Flas CRM — Monthly Plan",
        description: isYearly
          ? "Full access to Flas CRM with WhatsApp, Omnichannel & Invoicing (billed annually)"
          : "Full access to Flas CRM with WhatsApp, Omnichannel & Invoicing (billed monthly)",
      },
    },
    quantity: 1,
  };
}

export async function createStripeCheckoutSession(params: {
  tenantId: string;
  userId: string;
  userEmail?: string | null;
  plan: "flash_monthly" | "flash_yearly";
  successUrl: string;
  cancelUrl: string;
}): Promise<{ id: string; url: string | null }> {
  const stripe = getStripeClient();
  const lineItem = resolveStripeLineItem(params.plan);

  const createPayload: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    line_items: [lineItem],
    client_reference_id: params.userId,
    metadata: {
      tenantId: params.tenantId,
      userId: params.userId,
      plan: params.plan,
    },
    subscription_data: {
      metadata: {
        tenantId: params.tenantId,
        userId: params.userId,
        plan: params.plan,
      },
    },
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    allow_promotion_codes: true,
  };

  if (params.userEmail) {
    createPayload.customer_email = params.userEmail;
  }

  const session = await stripe.checkout.sessions.create(createPayload);

  return { id: session.id, url: session.url };
}

export async function createStripePortalSession(params: {
  customerId: string;
  returnUrl: string;
}): Promise<{ url: string }> {
  const stripe = getStripeClient();
  const session = await stripe.billingPortal.sessions.create({
    customer: params.customerId,
    return_url: params.returnUrl,
  });
  return { url: session.url };
}

export async function syncStripeOrganization(sync: {
  tenantId: string;
  status: string;
  plan?: string | undefined;
  periodEnd?: string | null;
  customerId?: string;
  subscriptionId?: string;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const patch: Record<string, unknown> = {
    billing_provider: "stripe",
  };
  if (sync.customerId) patch["stripe_customer_id"] = sync.customerId;
  if (sync.subscriptionId) patch["stripe_subscription_id"] = sync.subscriptionId;
  if (sync.plan) patch["plan"] = sync.plan;

  if (sync.status === "active" || sync.status === "trialing") {
    patch["subscription_status"] = sync.status === "trialing" ? "trial" : "active";
    patch["suspended"] = false;
  } else if (sync.status === "past_due") {
    patch["subscription_status"] = "past_due";
  } else if (sync.status === "canceled") {
    patch["subscription_status"] = "canceled";
    patch["suspended"] = true;
  }
  if (sync.periodEnd) patch["subscription_renews_at"] = sync.periodEnd;

  const { error } = await supabaseAdmin
    .from("organizations")
    .update(patch)
    .eq("id", sync.tenantId);

  if (error) {
    throw new Error(`Could not update company subscription: ${error.message}`);
  }

  const { logAudit } = await import("@/lib/audit.server");
  await logAudit({
    action: "billing.stripe_subscription_sync",
    tenantId: sync.tenantId,
    actorLabel: "stripe-webhook",
    entityType: "organization",
    entityId: sync.tenantId,
    details: { status: sync.status, periodEnd: sync.periodEnd ?? null },
  });
}

export async function recordStripeSubscriptionInvoice(params: {
  tenantId: string;
  userId?: string | null | undefined;
  customerId?: string | null | undefined;
  customerEmail?: string | null | undefined;
  customerName?: string | null | undefined;
  stripeInvoiceId: string;
  stripeSubscriptionId?: string | null | undefined;
  amountPaid: number;
  currency: string;
  planName?: string | null | undefined;
  invoiceNumber?: string | null | undefined;
  periodEnd?: string | null | undefined;
}): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Check if invoice already saved
  const { data: existing } = await supabaseAdmin
    .from("sales_documents")
    .select("id")
    .eq("tenant_id", params.tenantId)
    .filter("custom_fields->>stripe_invoice_id", "eq", params.stripeInvoiceId)
    .maybeSingle();

  if (existing) {
    return existing.id;
  }

  const { allocateNumber } = await import("@/lib/billing.server");
  let docNumber = params.invoiceNumber;
  if (!docNumber) {
    try {
      docNumber = await allocateNumber(params.tenantId, "invoice");
    } catch {
      docNumber = `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(1000 + Math.random() * 9000)}`;
    }
  }

  const amount = Number((params.amountPaid || 0).toFixed(2));
  const today = new Date().toISOString().slice(0, 10);

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("sales_documents")
    .insert({
      tenant_id: params.tenantId,
      kind: "invoice",
      status: "paid",
      doc_number: docNumber,
      issue_date: today,
      due_date: today,
      currency: (params.currency || "USD").toUpperCase(),
      subtotal: amount,
      grand_total: amount,
      paid_amount: amount,
      balance: 0,
      customer_snapshot: {
        name: params.customerName || "Company Subscriber",
        email: params.customerEmail || null,
      },
      company_snapshot: {
        name: "Flas CRM",
        tax_id: "FLAS-STRIPE-GLOBAL",
      },
      custom_fields: {
        stripe_invoice_id: params.stripeInvoiceId,
        stripe_subscription_id: params.stripeSubscriptionId ?? null,
        stripe_customer_id: params.customerId ?? null,
        provider: "stripe",
      },
      finalized_at: new Date().toISOString(),
      created_by: params.userId ?? null,
      notes: `Subscription paid via Stripe for ${params.planName || "Flas CRM Subscription"}`,
    } as any)
    .select("id")
    .single();

  if (insertError) {
    throw new Error(`Could not record subscription invoice: ${insertError.message}`);
  }

  const docId = inserted.id;

  // Insert sales document line item
  await supabaseAdmin.from("sales_document_items").insert({
    tenant_id: params.tenantId,
    document_id: docId,
    name_snapshot: `Flas CRM — ${params.planName || "Subscription"}`,
    quantity: 1,
    unit_price: amount,
    line_total: amount,
    position: 0,
  } as any);

  return docId;
}

/** Walks a test subscription through from checkout simulation to a saved invoice. Only callable in automated tests. */
export async function walkTestSubscriptionFlow(params: {
  tenantId: string;
  userId: string;
  userEmail?: string | null;
  plan: "flash_monthly" | "flash_yearly";
}): Promise<{
  ok: boolean;
  subscriptionId: string;
  customerId: string;
  invoiceId: string;
  salesDocumentId: string;
  docNumber: string;
}> {
  if (process.env["NODE_ENV"] !== "test") {
    throw new Error("walkTestSubscriptionFlow is strictly limited to automated unit tests.");
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const nonce = Math.floor(100000 + Math.random() * 900000);
  const testSubId = `sub_test_${nonce}`;
  const testCustId = `cus_test_${nonce}`;
  const testInvId = `in_test_${nonce}`;
  const isYearly = params.plan === "flash_yearly";
  const amount = isYearly ? 490 : 49;

  const now = new Date();
  const periodEnd = new Date(now);
  if (isYearly) {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  } else {
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  }
  const periodEndIso = periodEnd.toISOString();

  // 1. Record subscription row
  await supabaseAdmin.from("subscriptions").upsert(
    {
      user_id: params.userId,
      stripe_subscription_id: testSubId,
      stripe_customer_id: testCustId,
      product_id: isYearly ? "prod_yearly" : "prod_monthly",
      price_id: isYearly ? "price_yearly" : "price_monthly",
      status: "active",
      provider: "stripe",
      environment: "test",
      current_period_start: now.toISOString(),
      current_period_end: periodEndIso,
      updated_at: now.toISOString(),
    } as any,
    { onConflict: "stripe_subscription_id" },
  );

  // 2. Synchronize tenant organization
  await syncStripeOrganization({
    tenantId: params.tenantId,
    status: "active",
    plan: params.plan,
    periodEnd: periodEndIso,
    customerId: testCustId,
    subscriptionId: testSubId,
  });

  // 3. Record saved invoice in sales_documents
  const { allocateNumber } = await import("@/lib/billing.server");
  let docNumber: string;
  try {
    docNumber = await allocateNumber(params.tenantId, "invoice");
  } catch {
    docNumber = `INV-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${nonce.toString().slice(0, 4)}`;
  }

  const salesDocumentId = await recordStripeSubscriptionInvoice({
    tenantId: params.tenantId,
    userId: params.userId,
    customerId: testCustId,
    customerEmail: params.userEmail,
    customerName: "Workspace Admin",
    stripeInvoiceId: testInvId,
    stripeSubscriptionId: testSubId,
    amountPaid: amount,
    currency: "USD",
    planName: isYearly ? "Yearly Plan (Test)" : "Monthly Plan (Test)",
    invoiceNumber: docNumber,
    periodEnd: periodEndIso,
  });

  return {
    ok: true,
    subscriptionId: testSubId,
    customerId: testCustId,
    invoiceId: testInvId,
    salesDocumentId,
    docNumber,
  };
}

export async function handleStripeWebhook(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  const webhookSecret = getStripeWebhookSecret();
  if (!webhookSecret) {
    console.error("Stripe webhook secret is not configured in server environment.");
    return new Response("Stripe webhook secret not configured", { status: 500 });
  }

  const stripe = getStripeClient();
  let event: any;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err: any) {
    console.error("Stripe webhook signature verification failed:", err.message);
    return new Response(`Webhook signature verification failed: ${err.message}`, { status: 400 });
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data?.object;
        const userId = session?.client_reference_id || session?.metadata?.userId;
        const customerId =
          typeof session?.customer === "string" ? session.customer : session?.customer?.id;
        const subscriptionId =
          typeof session?.subscription === "string"
            ? session.subscription
            : session?.subscription?.id;
        const plan = session?.metadata?.plan || "flash_monthly";

        if (!userId) {
          console.warn("checkout.session.completed received without userId");
          break;
        }

        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("tenant_id")
          .eq("id", userId)
          .maybeSingle();

        const tenantId = profile?.tenant_id;
        if (!tenantId) {
          console.warn("No tenant profile found for subscriber user:", userId);
          break;
        }

        if (subscriptionId) {
          await supabaseAdmin.from("subscriptions").upsert(
            {
              user_id: userId,
              stripe_subscription_id: subscriptionId,
              stripe_customer_id: customerId,
              product_id: `prod_${plan}`,
              price_id: `price_${plan}`,
              status: "active",
              provider: "stripe",
              environment: session.livemode ? "live" : "test",
              updated_at: new Date().toISOString(),
            } as any,
            { onConflict: "stripe_subscription_id" },
          );

          await syncStripeOrganization({
            tenantId,
            status: "active",
            plan,
            customerId,
            subscriptionId,
          });
        }

        const invoiceId = session?.invoice;
        if (invoiceId && tenantId) {
          const amount = (session.amount_total || 0) / 100;
          await recordStripeSubscriptionInvoice({
            tenantId,
            userId,
            customerId,
            customerEmail: session.customer_details?.email || null,
            customerName: session.customer_details?.name || "Subscriber",
            stripeInvoiceId: typeof invoiceId === "string" ? invoiceId : invoiceId.id,
            stripeSubscriptionId: subscriptionId,
            amountPaid: amount,
            currency: session.currency || "USD",
            planName: plan === "flash_yearly" ? "Yearly Plan" : "Monthly Plan",
          });
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data?.object;
        const subscriptionId =
          typeof invoice?.subscription === "string"
            ? invoice.subscription
            : invoice?.subscription?.id;
        const customerId =
          typeof invoice?.customer === "string" ? invoice.customer : invoice?.customer?.id;
        const amountPaid = (invoice.amount_paid || invoice.total || 0) / 100;

        let tenantId: string | null = null;
        let userId: string | null = null;

        if (subscriptionId) {
          const { data: sub } = await supabaseAdmin
            .from("subscriptions")
            .select("user_id")
            .eq("stripe_subscription_id", subscriptionId)
            .maybeSingle();

          if (sub?.user_id) {
            userId = sub.user_id;
            const { data: profile } = await supabaseAdmin
              .from("profiles")
              .select("tenant_id")
              .eq("id", userId)
              .maybeSingle();
            tenantId = profile?.tenant_id ?? null;
          }
        }

        if (!tenantId && customerId) {
          const { data: org } = await supabaseAdmin
            .from("organizations")
            .select("id")
            .eq("stripe_customer_id", customerId)
            .maybeSingle();
          tenantId = org?.id ?? null;
        }

        if (tenantId) {
          const periodEnd = invoice.lines?.data?.[0]?.period?.end
            ? new Date(invoice.lines.data[0].period.end * 1000).toISOString()
            : null;

          await syncStripeOrganization({
            tenantId,
            status: "active",
            periodEnd,
            customerId,
            subscriptionId,
          });

          await recordStripeSubscriptionInvoice({
            tenantId,
            userId,
            customerId,
            customerEmail: invoice.customer_email || null,
            customerName: invoice.customer_name || null,
            stripeInvoiceId: invoice.id,
            stripeSubscriptionId: subscriptionId,
            amountPaid,
            currency: invoice.currency || "USD",
            planName: invoice.lines?.data?.[0]?.description || "Flas CRM Subscription",
            invoiceNumber: invoice.number,
            periodEnd,
          });
        }
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data?.object;
        const subscriptionId = sub.id;
        const status = sub.status;
        const periodEnd = sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null;

        const { data: row } = await supabaseAdmin
          .from("subscriptions")
          .update({
            status,
            current_period_start: sub.current_period_start
              ? new Date(sub.current_period_start * 1000).toISOString()
              : null,
            current_period_end: periodEnd,
            cancel_at_period_end: sub.cancel_at_period_end,
            updated_at: new Date().toISOString(),
          } as any)
          .eq("stripe_subscription_id", subscriptionId)
          .select("user_id")
          .maybeSingle();

        if (row?.user_id) {
          const { data: profile } = await supabaseAdmin
            .from("profiles")
            .select("tenant_id")
            .eq("id", row.user_id)
            .maybeSingle();

          if (profile?.tenant_id) {
            await syncStripeOrganization({
              tenantId: profile.tenant_id,
              status,
              periodEnd,
              subscriptionId,
            });
          }
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data?.object;
        const subscriptionId = sub.id;

        const { data: row } = await supabaseAdmin
          .from("subscriptions")
          .update({
            status: "canceled",
            updated_at: new Date().toISOString(),
          } as any)
          .eq("stripe_subscription_id", subscriptionId)
          .select("user_id")
          .maybeSingle();

        if (row?.user_id) {
          const { data: profile } = await supabaseAdmin
            .from("profiles")
            .select("tenant_id")
            .eq("id", row.user_id)
            .maybeSingle();

          if (profile?.tenant_id) {
            await syncStripeOrganization({
              tenantId: profile.tenant_id,
              status: "canceled",
              subscriptionId,
            });
          }
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data?.object;
        const customerId =
          typeof invoice?.customer === "string" ? invoice.customer : invoice?.customer?.id;

        if (customerId) {
          const { data: org } = await supabaseAdmin
            .from("organizations")
            .update({ subscription_status: "past_due" })
            .eq("stripe_customer_id", customerId)
            .select("id")
            .maybeSingle();

          if (org) {
            const { raiseAlert } = await import("@/lib/monitoring.server");
            await raiseAlert({
              title: "Stripe subscription payment failed",
              message: `Renewal payment failed for company ${org.id}. Retries running via Stripe.`,
              severity: "critical",
              source: "billing",
            });
          }
        }
        break;
      }

      default:
        break;
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error processing Stripe webhook:", error);
    return new Response(`Webhook handler error: ${error.message}`, { status: 500 });
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __mockStripe: any;
}
