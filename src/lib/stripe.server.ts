// Stripe billing service — checkout sessions, customer portal, and invoice tracking.
// Supports both live/test Stripe API and offline test fixtures.
import Stripe from "stripe";

/* eslint-disable @typescript-eslint/no-explicit-any */

export function getStripeKey(): string {
  return process.env["STRIPE_SECRET_KEY"] || "";
}

export function getStripeWebhookSecret(): string {
  return process.env["STRIPE_WEBHOOK_SECRET"] || "";
}

export function getStripePublishableKey(): string {
  return process.env["VITE_STRIPE_PUBLISHABLE_KEY"] || process.env["STRIPE_PUBLISHABLE_KEY"] || "";
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

  const { error } = await supabaseAdmin.from("organizations").update(patch).eq("id", sync.tenantId);

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

  const amount = Number((params.amountPaid || 0).toFixed(2));
  const today = new Date().toISOString().slice(0, 10);

  // 1. Concurrency & idempotency check: if invoice already exists, verify it has items
  const { data: existing } = await supabaseAdmin
    .from("sales_documents")
    .select("id")
    .eq("tenant_id", params.tenantId)
    .filter("custom_fields->>stripe_invoice_id", "eq", params.stripeInvoiceId)
    .maybeSingle();

  if (existing) {
    const { data: existingItems } = await supabaseAdmin
      .from("sales_document_items")
      .select("id")
      .eq("document_id", existing.id)
      .limit(1);

    if (existingItems && existingItems.length > 0) {
      return existing.id;
    }

    // Recover empty document if previous attempt failed after document insert
    const { error: recoveryErr } = await supabaseAdmin.from("sales_document_items").insert({
      tenant_id: params.tenantId,
      document_id: existing.id,
      name_snapshot: `Flas CRM — ${params.planName || "Subscription"}`,
      quantity: 1,
      unit_price: amount,
      line_total: amount,
      position: 0,
    } as any);

    if (recoveryErr) {
      throw new Error(`Could not record subscription invoice line items: ${recoveryErr.message}`);
    }
    return existing.id;
  }

  const { allocateNumber } = await import("@/lib/billing.server");
  let docNumber = params.invoiceNumber;
  if (!docNumber) {
    try {
      docNumber = await allocateNumber(params.tenantId, "invoice");
    } catch {
      docNumber = `INV-${today.replace(/-/g, "")}-${Math.floor(1000 + Math.random() * 9000)}`;
    }
  }

  // 2. Insert invoice document (segregated from customer sales with is_subscription_receipt)
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
      },
      custom_fields: {
        stripe_invoice_id: params.stripeInvoiceId,
        stripe_subscription_id: params.stripeSubscriptionId ?? null,
        stripe_customer_id: params.customerId ?? null,
        provider: "stripe",
        is_subscription_receipt: true,
      },
      finalized_at: new Date().toISOString(),
      created_by: params.userId ?? null,
      notes: `Subscription paid via Stripe for ${params.planName || "Flas CRM Subscription"}`,
    } as any)
    .select("id")
    .single();

  if (insertError) {
    // If concurrent insert occurred, return existing document
    if (insertError.code === "23505" || insertError.message.includes("unique")) {
      const { data: conflictDoc } = await supabaseAdmin
        .from("sales_documents")
        .select("id")
        .eq("tenant_id", params.tenantId)
        .filter("custom_fields->>stripe_invoice_id", "eq", params.stripeInvoiceId)
        .maybeSingle();
      if (conflictDoc) return conflictDoc.id;
    }
    throw new Error(`Could not record subscription invoice: ${insertError.message}`);
  }

  const docId = inserted.id;

  // 3. Insert line items atomically; rollback document on failure so we never leave an empty invoice
  const { error: itemError } = await supabaseAdmin.from("sales_document_items").insert({
    tenant_id: params.tenantId,
    document_id: docId,
    name_snapshot: `Flas CRM — ${params.planName || "Subscription"}`,
    quantity: 1,
    unit_price: amount,
    line_total: amount,
    position: 0,
  } as any);

  if (itemError) {
    await supabaseAdmin.from("sales_documents").delete().eq("id", docId);
    throw new Error(`Could not record subscription invoice line items: ${itemError.message}`);
  }

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
      tenant_id: params.tenantId,
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

        // Immutable tenant resolution from checkout session metadata
        let tenantId = session?.metadata?.tenantId;
        if (!tenantId && userId) {
          const { data: profile, error: pErr } = await supabaseAdmin
            .from("profiles")
            .select("tenant_id")
            .eq("id", userId)
            .maybeSingle();
          if (pErr) throw new Error(`DB error fetching profile: ${pErr.message}`);
          tenantId = profile?.tenant_id;
        }

        if (!tenantId) {
          console.warn("checkout.session.completed received without tenant binding");
          break;
        }

        // Validate tenant exists in organizations
        const { data: org, error: orgErr } = await supabaseAdmin
          .from("organizations")
          .select("id")
          .eq("id", tenantId)
          .maybeSingle();
        if (orgErr) throw new Error(`DB error verifying organization: ${orgErr.message}`);
        if (!org) {
          throw new Error(`Target organization ${tenantId} not found for checkout session`);
        }

        const isPaid = session.payment_status === "paid";

        if (subscriptionId) {
          const { error: subErr } = await supabaseAdmin.from("subscriptions").upsert(
            {
              tenant_id: tenantId,
              user_id: userId,
              stripe_subscription_id: subscriptionId,
              stripe_customer_id: customerId,
              product_id: `prod_${plan}`,
              price_id: `price_${plan}`,
              status: isPaid ? "active" : "incomplete",
              provider: "stripe",
              environment: session.livemode ? "live" : "test",
              updated_at: new Date().toISOString(),
            } as any,
            { onConflict: "stripe_subscription_id" },
          );
          if (subErr) {
            throw new Error(`DB error upserting subscription: ${subErr.message}`);
          }

          if (isPaid) {
            await syncStripeOrganization({
              tenantId,
              status: "active",
              plan,
              customerId,
              subscriptionId,
            });
          }
        }

        const invoiceId = session?.invoice;
        // Verify settlement before creating paid invoice evidence
        if (isPaid && invoiceId && tenantId) {
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

        // 1. Resolve tenant immutably from subscription binding
        if (subscriptionId) {
          const { data: sub, error: subErr } = await supabaseAdmin
            .from("subscriptions")
            .select("tenant_id, user_id")
            .eq("stripe_subscription_id", subscriptionId)
            .maybeSingle();

          if (subErr) throw new Error(`DB error fetching subscription: ${subErr.message}`);
          if (sub?.tenant_id) {
            tenantId = sub.tenant_id;
            userId = sub.user_id;
          }
        }

        // 2. Resolve from organization by customer ID
        if (!tenantId && customerId) {
          const { data: org, error: orgErr } = await supabaseAdmin
            .from("organizations")
            .select("id")
            .eq("stripe_customer_id", customerId)
            .maybeSingle();
          if (orgErr) throw new Error(`DB error fetching organization: ${orgErr.message}`);
          tenantId = org?.id ?? null;
        }

        // 3. Fallback to invoice metadata
        if (!tenantId) {
          tenantId =
            invoice.subscription_details?.metadata?.tenantId || invoice.metadata?.tenantId || null;
        }

        // 4. Fallback to live Stripe subscription retrieval (handles out-of-order webhook delivery)
        if (!tenantId && subscriptionId) {
          try {
            const stripeClient = getStripeClient();
            if (stripeClient?.subscriptions?.retrieve) {
              const liveSub = await stripeClient.subscriptions.retrieve(subscriptionId);
              tenantId = liveSub?.metadata?.["tenantId"] ?? null;
              if (!userId) userId = liveSub?.metadata?.["userId"] ?? null;
            }
          } catch (liveErr) {
            console.warn("Could not retrieve subscription live from Stripe:", liveErr);
          }
        }

        // Immutable ownership: never fall back to current profiles.tenant_id
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
        } else {
          // If subscriptionId is present but tenantId could not be resolved yet, fail with 500 to preserve Stripe webhook retry
          if (subscriptionId) {
            throw new Error(
              `invoice.payment_succeeded could not resolve tenant ownership for subscription ${subscriptionId}; retrying`,
            );
          }
          console.warn(
            "invoice.payment_succeeded could not resolve tenant ownership for subscription:",
            subscriptionId,
          );
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

        const { data: row, error: subErr } = await supabaseAdmin
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
          .select("tenant_id, user_id")
          .maybeSingle();

        if (subErr) {
          throw new Error(`DB error updating subscription: ${subErr.message}`);
        }

        let tenantId = row?.tenant_id;
        if (!tenantId) {
          const { data: org, error: orgErr } = await supabaseAdmin
            .from("organizations")
            .select("id")
            .eq("stripe_subscription_id", subscriptionId)
            .maybeSingle();
          if (orgErr) throw new Error(`DB error fetching org by subscription: ${orgErr.message}`);
          tenantId = org?.id ?? sub.metadata?.tenantId ?? null;
        }

        if (tenantId) {
          await syncStripeOrganization({
            tenantId,
            status,
            periodEnd,
            subscriptionId,
          });
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data?.object;
        const subscriptionId = sub.id;

        const { data: row, error: subErr } = await supabaseAdmin
          .from("subscriptions")
          .update({
            status: "canceled",
            updated_at: new Date().toISOString(),
          } as any)
          .eq("stripe_subscription_id", subscriptionId)
          .select("tenant_id, user_id")
          .maybeSingle();

        if (subErr) {
          throw new Error(`DB error updating subscription cancellation: ${subErr.message}`);
        }

        let tenantId = row?.tenant_id;
        if (!tenantId) {
          const { data: org, error: orgErr } = await supabaseAdmin
            .from("organizations")
            .select("id")
            .eq("stripe_subscription_id", subscriptionId)
            .maybeSingle();
          if (orgErr) throw new Error(`DB error fetching org by subscription: ${orgErr.message}`);
          tenantId = org?.id ?? sub.metadata?.tenantId ?? null;
        }

        if (tenantId) {
          await syncStripeOrganization({
            tenantId,
            status: "canceled",
            subscriptionId,
          });
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data?.object;
        const customerId =
          typeof invoice?.customer === "string" ? invoice.customer : invoice?.customer?.id;

        if (customerId) {
          const { data: org, error: orgErr } = await supabaseAdmin
            .from("organizations")
            .update({ subscription_status: "past_due" })
            .eq("stripe_customer_id", customerId)
            .select("id")
            .maybeSingle();

          if (orgErr) {
            throw new Error(`DB error updating past_due status: ${orgErr.message}`);
          }

          if (org) {
            const { raiseAlert } = await import("@/lib/monitoring.server");
            await raiseAlert({
              title: "Stripe subscription payment failed",
              message: `Renewal payment failed for company ${org.id}. Retries running via Stripe.`,
              severity: "critical",
              source: "billing",
              tenantId: org.id,
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
  var __mockStripe: any;
}
