/*
 * The Flas agent: planning, and carrying out one approved step.
 *
 * Two halves, deliberately separated by a person.
 *
 *   planTask()    asks the model what it would do, and returns proposals.
 *                 Nothing is executed here. The model's output is data.
 *   executeStep() carries out ONE step that has already been validated and,
 *                 for anything that writes or sends, explicitly approved.
 *
 * The separation is the safety property. A prompt injected into a customer's
 * WhatsApp message can, at worst, cause a *proposal* to appear on screen with
 * its wording visible. It cannot cause a send, because the confirmation does
 * not come from the model — it comes from a click.
 *
 * Reads and writes go through the caller's own RLS-scoped client, so tenant
 * isolation is enforced by the database rather than by the correctness of the
 * code below. supabaseAdmin appears exactly once, for WhatsApp credentials,
 * which are deliberately unreadable by an ordinary session.
 */
import { callFlashAi } from "@/lib/flash-ai.server";
import {
  AgentPlanSchema,
  actionSpec,
  describeActionsForModel,
  validatePlan,
  type ContactStage,
  type RejectedStep,
  type ValidatedStep,
} from "@/lib/agent-actions";

type AnyClient = import("@supabase/supabase-js").SupabaseClient;

export type AgentContext = {
  supabase: AnyClient;
  tenantId: string;
  userId: string;
};

/* ── Planning ─────────────────────────────────────────────────────────────── */

function systemPrompt(business: string): string {
  return [
    "You are the Flas assistant. You run inside a small business's CRM and you can operate it.",
    "",
    "You are experienced, direct and commercially minded. You speak plainly, you do not flatter,",
    "and you say when something is a bad idea. You never invent facts about this business: if you",
    "need a number, a price or a customer's details, read them with an action first.",
    "",
    "THE BUSINESS YOU ARE WORKING FOR:",
    business,
    "",
    "ACTIONS YOU MAY PROPOSE:",
    describeActionsForModel(),
    "",
    "HOW TO REPLY — this is strict. Reply with ONE JSON object and nothing else. No prose before",
    "or after it, no markdown fence. The shape is:",
    "",
    '{ "understanding": "<one sentence restating the task in your own words>",',
    '  "steps": [ { "action": "<name>", "input": { ... }, "why": "<short reason>" } ],',
    '  "question": "<ask here if you cannot proceed without an answer; omit otherwise>" }',
    "",
    "RULES:",
    "- Read before you write. Search for a customer before creating one; read prices before quoting.",
    "- Never guess an id. If you do not have a contactId from a previous step, propose the search",
    "  first and stop — do not invent a uuid.",
    "- Actions marked [write] and [send] are shown to a person for approval. Propose them only when",
    "  the task genuinely calls for them.",
    "- [send] reaches a real customer and cannot be undone. Include the exact wording you intend.",
    "- If the request is unclear, return an empty steps array and ask one specific question.",
    "- If the request cannot be done with these actions, say so in `understanding` and return no steps.",
  ].join("\n");
}

/** Headline facts, so advice is about this business rather than businesses in general. */
async function businessBrief(ctx: AgentContext): Promise<string> {
  const [org, contacts, products, unpaid] = await Promise.all([
    ctx.supabase
      .from("organizations")
      .select("name, currency, country, timezone")
      .eq("id", ctx.tenantId)
      .maybeSingle(),
    ctx.supabase.from("contacts").select("id", { count: "exact", head: true }),
    ctx.supabase.from("products").select("id", { count: "exact", head: true }),
    ctx.supabase.from("sales_documents").select("balance").eq("kind", "invoice").gt("balance", 0),
  ]);

  const owed = (unpaid.data ?? []).reduce((sum, r) => sum + Number(r.balance ?? 0), 0);
  const o = org.data;
  return [
    `Name: ${o?.name ?? "unknown"}`,
    `Currency: ${o?.currency ?? "AED"}`,
    `Country: ${o?.country ?? "unknown"}`,
    `Contacts: ${contacts.count ?? 0}`,
    `Products in catalogue: ${products.count ?? 0}`,
    `Outstanding on unpaid invoices: ${owed.toFixed(2)} ${o?.currency ?? "AED"}`,
  ].join("\n");
}

/**
 * Pulls the JSON object out of a model reply.
 *
 * Models add a fence or a sentence of preamble however firmly they are asked
 * not to. Rather than fail the whole task on that, take the outermost braced
 * span — and if that is not valid JSON, fail honestly rather than repairing it,
 * because a half-understood plan is worse than none.
 */
export function extractJson(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

export async function planTask(
  ctx: AgentContext,
  task: string,
  priorResults: { action: string; result: unknown }[] = [],
): Promise<{
  understanding: string;
  question: string | null;
  steps: ValidatedStep[];
  rejected: RejectedStep[];
}> {
  const brief = await businessBrief(ctx);

  // Results of steps already run, so a follow-up plan can use the real ids
  // rather than being asked to remember them.
  const history = priorResults.length
    ? `\n\nRESULTS SO FAR (use these ids; do not invent others):\n${JSON.stringify(priorResults).slice(0, 6000)}`
    : "";

  const raw = await callFlashAi(systemPrompt(brief), `${task}${history}`, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    feature: "agent",
  });

  const parsed = AgentPlanSchema.safeParse(extractJson(raw));
  if (!parsed.success) {
    return {
      understanding:
        "The assistant did not return a usable plan. Try rephrasing the task in one sentence.",
      question: null,
      steps: [],
      rejected: [],
    };
  }
  const { steps, rejected } = validatePlan(parsed.data);
  return {
    understanding: parsed.data.understanding,
    question: parsed.data.question ?? null,
    steps,
    rejected,
  };
}

/* ── Execution ────────────────────────────────────────────────────────────── */

export type StepResult = { ok: true; summary: string; data: unknown } | { ok: false; error: string };

/**
 * Runs one step.
 *
 * `confirmed` is passed by the route from the request, and the route only sets
 * it when the person clicked approve. It is checked here as well as there:
 * a second guard costs nothing and this is the boundary where an unattended
 * write would actually happen.
 */
export async function executeStep(
  ctx: AgentContext,
  step: ValidatedStep,
  confirmed: boolean,
): Promise<StepResult> {
  const spec = actionSpec(step.action);
  if (!spec) return { ok: false, error: "Unknown action." };
  if (spec.risk !== "read" && !confirmed) {
    return { ok: false, error: "This action changes or sends something and was not approved." };
  }

  const db = ctx.supabase;
  const i = step.input;

  try {
    switch (step.action) {
      case "find_contacts": {
        const q = String(i["query"]);
        // Quoted so a comma or parenthesis in the term cannot add filter clauses.
        const safe = `"%${q.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}%"`;
        const { data, error } = await db
          .from("contacts")
          .select("id, name, phone, email, company, stage")
          .or(`name.ilike.${safe},phone.ilike.${safe},email.ilike.${safe},company.ilike.${safe}`)
          .limit(Number(i["limit"] ?? 10));
        if (error) throw error;
        return { ok: true, summary: `Found ${data?.length ?? 0} contact(s)`, data };
      }

      case "get_contact_overview": {
        const id = String(i["contactId"]);
        const [contact, identities, branches, invoices] = await Promise.all([
          db.from("contacts").select("*").eq("id", id).maybeSingle(),
          db
            .from("contact_identities")
            .select("kind, value, label, is_primary, branch_id")
            .eq("contact_id", id),
          db.from("contact_branches").select("id, name, city").eq("contact_id", id),
          db
            .from("sales_documents")
            .select("doc_number, kind, total, balance, due_date, status")
            .eq("contact_id", id)
            .order("created_at", { ascending: false })
            .limit(10),
        ]);
        if (!contact.data) return { ok: false, error: "No such contact in this workspace." };
        return {
          ok: true,
          summary: `Read ${contact.data.name}'s record`,
          data: {
            contact: contact.data,
            identities: identities.data ?? [],
            branches: branches.data ?? [],
            documents: invoices.data ?? [],
          },
        };
      }

      case "list_products": {
        let q = db.from("products").select("id, title, sku, price").limit(50);
        if (i["query"]) q = q.ilike("title", `%${String(i["query"])}%`);
        const { data, error } = await q;
        if (error) throw error;
        return { ok: true, summary: `${data?.length ?? 0} product(s)`, data };
      }

      case "list_unpaid_invoices": {
        const { data, error } = await db
          .from("sales_documents")
          .select("id, doc_number, contact_id, total, balance, due_date, status")
          .eq("kind", "invoice")
          .gt("balance", 0)
          .order("due_date", { ascending: true })
          .limit(Number(i["limit"] ?? 20));
        if (error) throw error;
        return { ok: true, summary: `${data?.length ?? 0} unpaid invoice(s)`, data };
      }

      case "business_snapshot": {
        const [contacts, conversations, products, unpaid] = await Promise.all([
          db.from("contacts").select("id", { count: "exact", head: true }),
          db.from("conversations").select("id", { count: "exact", head: true }),
          db.from("products").select("id", { count: "exact", head: true }),
          db.from("sales_documents").select("balance").eq("kind", "invoice").gt("balance", 0),
        ]);
        const owed = (unpaid.data ?? []).reduce((s, r) => s + Number(r.balance ?? 0), 0);
        return {
          ok: true,
          summary: "Read the workspace snapshot",
          data: {
            contacts: contacts.count ?? 0,
            conversations: conversations.count ?? 0,
            products: products.count ?? 0,
            unpaidInvoices: unpaid.data?.length ?? 0,
            outstanding: owed,
          },
        };
      }

      case "create_contact": {
        const { data, error } = await db
          .from("contacts")
          .insert({
            // tenant_id is set by the caller's own RLS context, never by the model.
            tenant_id: ctx.tenantId,
            name: String(i["name"]),
            phone: i["phone"] ? String(i["phone"]) : null,
            email: i["email"] ? String(i["email"]) : null,
            company: i["company"] ? String(i["company"]) : null,
          })
          .select("id, name")
          .single();
        if (error) throw error;

        // Record the number and email as identities, so this customer's first
        // WhatsApp resolves to this record by its normalized form. Without
        // them the inbound path falls back to an exact match on the raw
        // column, and "+971 50 963 0506" typed here would not match an
        // inbound "971509630506" -- a duplicate customer.
        //
        // Conflicts are ignored, as wa.server ignores them: the unique index
        // means another record already claims the value, and moving it here
        // would silently merge two customers.
        const identities = [
          i["phone"] ? { kind: "phone", value: String(i["phone"]) } : null,
          i["email"] ? { kind: "email", value: String(i["email"]) } : null,
        ].filter((x): x is { kind: string; value: string } => x !== null);
        for (const identity of identities) {
          await db
            .from("contact_identities")
            .insert({ tenant_id: ctx.tenantId, contact_id: data.id, is_primary: true, ...identity })
            .then(
              () => undefined,
              () => undefined,
            );
        }
        return { ok: true, summary: `Created ${data.name}`, data };
      }

      case "add_contact_number": {
        const { error } = await db.from("contact_identities").insert({
          tenant_id: ctx.tenantId,
          contact_id: String(i["contactId"]),
          kind: String(i["kind"]),
          value: String(i["value"]),
          label: i["label"] ? String(i["label"]) : null,
          branch_id: i["branchId"] ? String(i["branchId"]) : null,
        });
        if (error) {
          if (error.code === "23505") {
            return {
              ok: false,
              error: "That number or email already belongs to another contact here.",
            };
          }
          throw error;
        }
        return { ok: true, summary: step.summary, data: null };
      }

      case "add_contact_branch": {
        const { data, error } = await db
          .from("contact_branches")
          .insert({
            tenant_id: ctx.tenantId,
            contact_id: String(i["contactId"]),
            name: String(i["name"]),
            city: i["city"] ? String(i["city"]) : null,
            address: i["address"] ? String(i["address"]) : null,
          })
          .select("id, name")
          .single();
        if (error) throw error;
        return { ok: true, summary: `Added branch ${data.name}`, data };
      }

      case "set_contact_stage": {
        const { error } = await db
          .from("contacts")
          .update({ stage: String(i["stage"]) as ContactStage })
          .eq("id", String(i["contactId"]));
        if (error) throw error;
        return { ok: true, summary: step.summary, data: null };
      }

      case "draft_quotation": {
        const { buildCustomerSnapshot, ensureBillingSettings, saveDraftDocument } =
          await import("@/lib/billing.server");
        const { todayInTimeZone } = await import("@/lib/locale");
        const { data: org } = await db
          .from("organizations")
          .select("currency, timezone")
          .eq("id", ctx.tenantId)
          .maybeSingle();
        const settings = await ensureBillingSettings(db, ctx.tenantId).catch(() => null);
        const { data: contact } = await db
          .from("contacts")
          .select("name")
          .eq("id", String(i["contactId"]))
          .maybeSingle();
        if (!contact) return { ok: false, error: "No such contact in this workspace." };
        // Reuse the app's own snapshot builder rather than assembling one here,
        // so an agent-drafted quotation carries the same customer fields a
        // hand-made one does.
        const snapshot = await buildCustomerSnapshot(db, String(i["contactId"]));

        const items = (i["items"] as { description: string; quantity: number; unitPrice: number }[])
          .map((line) => ({
            product_id: null,
            name: line.description,
            sku: null,
            description: line.description,
            quantity: line.quantity,
            unit: null,
            unit_price: line.unitPrice,
            discount_value: 0,
            discount_type: "percent" as const,
            tax_rate: Number(settings?.default_tax_rate ?? 0),
          }));

        const result = await saveDraftDocument(db, ctx.userId, {
          kind: "quotation",
          contact_id: String(i["contactId"]),
          customer_snapshot: snapshot,
          bank_account_id: null,
          quotation_id: null,
          issue_date: todayInTimeZone(org?.timezone ?? null),
          due_date: null,
          currency: org?.currency ?? "AED",
          payment_terms: null,
          reference: null,
          notes: i["notes"] ? String(i["notes"]) : null,
          terms: settings?.default_terms ?? null,
          invoice_discount: 0,
          shipping: 0,
          additional_charges: 0,
          adjustment: 0,
          items,
        });
        return { ok: true, summary: "Drafted a quotation", data: result };
      }

      case "send_whatsapp_message": {
        const id = String(i["contactId"]);
        const { data: contact } = await db
          .from("contacts")
          .select("name, phone, consent_given")
          .eq("id", id)
          .maybeSingle();
        if (!contact) return { ok: false, error: "No such contact in this workspace." };
        if (!contact.phone) return { ok: false, error: `${contact.name} has no phone number.` };
        // The consent gate is a legal requirement, not a preference, and the
        // agent is not a way around it.
        if (!contact.consent_given) {
          return {
            ok: false,
            error: `${contact.name} has not agreed to be contacted. Record consent on their contact card first.`,
          };
        }

        const { resolveWaCredentials, sendWhatsAppText } = await import("@/lib/wa.server");
        const creds = await resolveWaCredentials(ctx.tenantId, null);
        await sendWhatsAppText(contact.phone, String(i["body"]), creds);

        const { logAudit } = await import("@/lib/audit.server");
        await logAudit({
          action: "agent.message_sent",
          tenantId: ctx.tenantId,
          actorId: ctx.userId,
          entityType: "contact",
          entityId: id,
          details: { via: "agent" },
        });
        return { ok: true, summary: `Sent to ${contact.name}`, data: null };
      }

      default:
        return { ok: false, error: "That action is not implemented." };
    }
  } catch (e) {
    const { redactSecrets } = await import("@/lib/integration-errors.server");
    return { ok: false, error: redactSecrets(e instanceof Error ? e.message : String(e)) ?? "Failed" };
  }
}
