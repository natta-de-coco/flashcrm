/**
 * src/lib/drip-automation.server.ts
 *
 * Multi-Step Email Marketing Drip Funnel & Sequence Engine.
 * Manages automated nurture journeys:
 *   - Step 1 (Day 0/1): Welcome Discount (e.g. WELCOME20)
 *   - Step 2 (Day 3): Product / Solution Showcase & Demo
 *   - Step 3 (Day 7): Urgency Offer Expiry Reminder (e.g. LASTCHANCE20)
 *
 * Strictly respects unsubscribe requests. No mail transport is connected yet, so a step is never
 * sent and never recorded as sent: it is logged as not sent and the enrolment stays where it is.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { substituteMergeTags } from "./email-templates.ts";
import { recordEmailNotSent, whyMarketingEmailCannotBeSent } from "./lead-automation.server.ts";

interface UntypedDbResult<T = UntypedRow> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

interface UntypedRow {
  id?: string;
  sequence_id?: string;
  step_number?: number;
  delay_days?: number;
  template_id?: string;
  subject?: string;
  discount_code?: string | null;
  business_name?: string | null;
  verified?: boolean | null;
  smtp_host?: string | null;
  from_email?: string | null;
  domain?: string | null;
  status?: string;
  [key: string]: unknown;
}

interface UntypedDbQuery {
  select: (cols?: string) => UntypedDbQuery;
  insert: (values: unknown) => UntypedDbQuery;
  update: (values: unknown) => UntypedDbQuery;
  delete: () => UntypedDbQuery;
  eq: (col: string, val: unknown) => UntypedDbQuery;
  in: (col: string, vals: unknown[]) => UntypedDbQuery;
  order: (col: string, opts?: unknown) => UntypedDbQuery;
  limit: (count: number) => UntypedDbQuery;
  single: <T = UntypedRow>() => Promise<UntypedDbResult<T>>;
  maybeSingle: <T = UntypedRow>() => Promise<UntypedDbResult<T>>;
  then: <T = UntypedRow>(resolve: (val: UntypedDbResult<T>) => void) => Promise<unknown>;
}

interface UntypedDbClient {
  from: (table: string) => UntypedDbQuery;
  rpc: (fn: string, args?: unknown) => Promise<UntypedDbResult<unknown>>;
}

const db = supabaseAdmin as unknown as UntypedDbClient;

export interface DripSequenceStep {
  stepNumber: number;
  delayDays: number;
  templateId: string;
  subject: string;
  discountCode?: string | null;
}

export const DEFAULT_DRIP_STEPS: DripSequenceStep[] = [
  {
    stepNumber: 1,
    delayDays: 0,
    templateId: "welcome_discount",
    subject: "Welcome to {{company}}! Here is your 20% discount code",
    discountCode: "WELCOME20",
  },
  {
    stepNumber: 2,
    delayDays: 3,
    templateId: "product_showcase",
    subject: "Discover how {{company}} powers growth for modern businesses",
    discountCode: "WELCOME20",
  },
  {
    stepNumber: 3,
    delayDays: 7,
    templateId: "flash_sale",
    subject: "Final 48 Hours: Your 20% promotional discount is expiring",
    discountCode: "LASTCHANCE20",
  },
];

/**
 * Ensures a default 3-step growth sequence exists for the tenant.
 */
export async function getOrCreateDefaultSequence(tenantId: string): Promise<string> {
  const { data: existing } = await db
    .from("drip_sequences")
    .select("id")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (existing?.id) return existing.id;

  const { data: created, error } = await db
    .from("drip_sequences")
    .insert({
      tenant_id: tenantId,
      name: "New Lead Welcome & 7-Day Growth Nurture",
      description:
        "Automated 3-step funnel: Day 0 Welcome Discount -> Day 3 Showcase -> Day 7 Expiry",
      trigger_event: "lead_consented_intake",
      active: true,
    })
    .select("id")
    .single();

  if (error || !created) {
    throw new Error(`Failed to initialize default drip sequence: ${error?.message}`);
  }

  // Insert default steps
  for (const step of DEFAULT_DRIP_STEPS) {
    await db.from("drip_steps").insert({
      sequence_id: created.id,
      step_number: step.stepNumber,
      delay_days: step.delayDays,
      template_id: step.templateId,
      subject: step.subject,
      discount_code: step.discountCode ?? null,
    });
  }

  if (!created?.id) {
    throw new Error("Created sequence missing id");
  }

  return created.id;
}

/**
 * Enrolls a consented lead into the automated drip funnel.
 */
export async function enrollLeadInDripSequence(args: {
  tenantId: string;
  leadId?: string | null;
  contactId?: string | null;
  email: string;
  name?: string | null;
}): Promise<{ enrolled: boolean; sequenceId?: string; enrollmentId?: string }> {
  const { tenantId, leadId, contactId, email, name } = args;
  const cleanEmail = email.toLowerCase().trim();

  try {
    const sequenceId = await getOrCreateDefaultSequence(tenantId);

    // Check if already active in this sequence
    const { data: activeEnrollment } = await db
      .from("drip_enrollments")
      .select("id, status")
      .eq("tenant_id", tenantId)
      .eq("email", cleanEmail)
      .in("status", ["enrolled", "in_progress"])
      .maybeSingle();

    if (activeEnrollment) {
      return {
        enrolled: false,
        sequenceId,
        ...(activeEnrollment.id ? { enrollmentId: activeEnrollment.id } : {}),
      };
    }

    // Insert new enrollment
    const nextRun = new Date(); // Step 1 runs immediately or on first queue cycle
    const { data: enrollment, error } = await db
      .from("drip_enrollments")
      .insert({
        tenant_id: tenantId,
        sequence_id: sequenceId,
        lead_id: leadId || null,
        contact_id: contactId || null,
        email: cleanEmail,
        current_step: 1,
        status: "in_progress",
        next_run_at: nextRun.toISOString(),
      })
      .select("id")
      .single();

    if (error || !enrollment?.id) {
      console.error("[drip] Error enrolling lead:", error);
      return { enrolled: false };
    }

    // Attempt instant dispatch of Step 1
    await dispatchDripStepForEnrollment({
      enrollmentId: enrollment.id,
      tenantId,
      email: cleanEmail,
      name: name ?? null,
      stepNumber: 1,
    });

    return { enrolled: true, sequenceId, enrollmentId: enrollment.id };
  } catch (e) {
    console.error("[drip] Failed to enroll lead in drip sequence:", e);
    return { enrolled: false };
  }
}

/**
 * Tries to send a specific step for an enrollment.
 *
 * With no mail transport connected nothing is sent: the step is logged as not sent (with the
 * reason) and the enrolment is NOT advanced (current_step, next_run_at and last_sent_at stay as
 * they are), so a later real send starts at this same step. Returns true only when the step is
 * done (nothing left to send, or sent); false when it was not sent. A real send must advance the
 * enrolment only after the provider has accepted the message, and leave it unchanged when the
 * send is refused or its outcome is uncertain.
 */
export async function dispatchDripStepForEnrollment(args: {
  enrollmentId: string;
  tenantId: string;
  email: string;
  name: string | null;
  stepNumber: number;
}): Promise<boolean> {
  const { enrollmentId, tenantId, email, name, stepNumber } = args;

  // 1. Fetch step details
  const { data: enrollment, error: enrollmentError } = await db
    .from("drip_enrollments")
    .select("sequence_id, status")
    .eq("id", enrollmentId)
    .single();

  if (enrollmentError) {
    // Could not read it: not the same as "nothing to do", and nothing is changed.
    console.error("[drip] Could not read the enrolment; the step was left as it was");
    return false;
  }
  if (!enrollment || enrollment.status === "unsubscribed" || enrollment.status === "completed") {
    return false;
  }

  const { data: step, error: stepError } = await db
    .from("drip_steps")
    .select("*")
    .eq("sequence_id", enrollment.sequence_id)
    .eq("step_number", stepNumber)
    .maybeSingle();

  if (stepError) {
    // A step that could not be read is not a step that does not exist: do not finish the enrolment.
    console.error("[drip] Could not read the step; the enrolment was left as it was");
    return false;
  }

  if (!step) {
    // Last step reached, complete enrollment
    const { error: completeError } = await db
      .from("drip_enrollments")
      .update({ status: "completed", updated_at: new Date().toISOString() })
      .eq("id", enrollmentId);
    if (completeError) {
      console.error("[drip] Could not mark the enrolment completed");
      return false;
    }
    return true;
  }

  // 2. Fetch tenant company and SMTP configuration
  const [{ data: company }, { data: smtp }] = await Promise.all([
    db.from("business_profiles").select("business_name").eq("tenant_id", tenantId).maybeSingle(),
    db.from("tenant_smtp_config").select("*").eq("tenant_id", tenantId).maybeSingle(),
  ]);

  const companyName = company?.business_name || "Flas CRM";
  const discountCode = step.discount_code || "WELCOME20";

  const renderedSubject = substituteMergeTags(step.subject || "", {
    name: name || "there",
    company: companyName,
    discount_code: discountCode,
  });

  // Nothing here can send a message yet, so this step is recorded as not sent, with the reason
  // (a missing unsubscribe link is reported first), and the enrolment is left exactly as it was.
  const reason = whyMarketingEmailCannotBeSent({ email, tenantId });
  await recordEmailNotSent({
    tag: "drip",
    tenantId,
    recipient: email,
    fromAddress: smtp?.from_email || `noreply@${smtp?.domain || "flas.mobidigisol.com"}`,
    subject: renderedSubject,
    template: `drip_step_${stepNumber}`,
    provider: "tenant_smtp",
    providerMsgId: `drip_${enrollmentId}_s${stepNumber}_unsent`,
    reason,
    meta: {
      step_number: stepNumber,
      enrollment_id: enrollmentId,
      discount_code: discountCode,
      smtp_verified: Boolean(smtp?.verified && smtp.smtp_host),
    },
  });
  return false;
}

/**
 * Instantly cancels all active drip enrollments when a user clicks unsubscribe.
 * Throws if the database refuses, so the caller cannot report the withdrawal as done.
 */
export async function cancelDripEnrollmentsForEmail(
  tenantId: string,
  email: string,
): Promise<number> {
  const cleanEmail = email.toLowerCase().trim();
  const { data, error } = await db
    .from("drip_enrollments")
    .update({
      status: "unsubscribed",
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId)
    .eq("email", cleanEmail)
    .in("status", ["enrolled", "in_progress"])
    .select("id");

  if (error) {
    // "Nothing to cancel" (0) and "could not cancel" are different answers: the caller is
    // finishing a withdrawal of consent and must not report it done. The database's own message
    // is not passed on, because it can quote the address.
    throw Object.assign(new Error("Could not cancel drip enrollments"), {
      code: error.code ?? "error",
    });
  }

  return (data as unknown[] | null)?.length ?? 0;
}
