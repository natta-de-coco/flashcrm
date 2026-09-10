/*
 * What the Flas agent is allowed to do, and what it must ask before doing.
 *
 * The assistant could previously only produce text. This is the catalogue of
 * real operations it can propose against the workspace — find a customer, raise
 * a quotation, message someone — expressed as data rather than as prose, so
 * every proposal is validated before anything happens.
 *
 * Three rules hold this together, and none of them are negotiable:
 *
 *   1. The model never supplies tenant_id. It is read from the caller's own
 *      profile at execution time. A model that hallucinated one, or was talked
 *      into naming another company's, still cannot reach it.
 *
 *   2. Every action declares a risk. `read` may run unattended; `write` and
 *      `send` are refused by the server unless the request carries an explicit
 *      confirmation from the person. The model cannot set that flag — it comes
 *      from a click.
 *
 *   3. `send` is its own class, above `write`, because it reaches a customer.
 *      An unwanted database row can be deleted; an unwanted WhatsApp message
 *      cannot be unsent, and in the UAE it is also a consent question.
 *
 * This file is deliberately pure: no server imports, no database client. It is
 * the contract the planner and the executor both read, so they cannot drift.
 */
import { z } from "zod";

/**
 * Values that survive the trip to the browser.
 *
 * Action input is declared with this rather than `unknown` because these
 * objects cross a server-function boundary, and the framework refuses to
 * serialize a type it cannot prove is safe.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

/** How much damage a mistake could do, which decides what is asked first. */
export type ActionRisk = "read" | "write" | "send";

export type ActionSpec = {
  name: string;
  /** Shown on the confirmation card. */
  title: string;
  /** Given to the model. Written for the model, not for the UI. */
  description: string;
  risk: ActionRisk;
  schema: z.ZodTypeAny;
  /** One line describing the specific proposed call, for a human to approve. */
  summarize: (input: Record<string, JsonValue>) => string;
};

const str = (v: JsonValue | undefined) => (typeof v === "string" ? v : "");

/* ── Reading ──────────────────────────────────────────────────────────────── */

const findContacts: ActionSpec = {
  name: "find_contacts",
  title: "Search contacts",
  description:
    "Search this workspace's contacts by name, phone number, email or company. Use this first whenever a task mentions a customer by name, so later steps can use the real contact id rather than a guess.",
  risk: "read",
  schema: z.object({
    query: z.string().trim().min(2).max(100),
    limit: z.number().int().min(1).max(25).optional(),
  }),
  summarize: (i) => `Search contacts for "${str(i["query"])}"`,
};

const getContactOverview: ActionSpec = {
  name: "get_contact_overview",
  title: "Open a customer's file",
  description:
    "Everything known about one contact: their numbers and emails, their branches, recent conversation, and any unpaid invoices. Use before advising on a customer or drafting a message to them.",
  risk: "read",
  schema: z.object({ contactId: z.string().uuid() }),
  summarize: () => "Read the customer's full record",
};

const listProducts: ActionSpec = {
  name: "list_products",
  title: "List products",
  description:
    "The workspace's catalogue: titles, SKUs and prices. Use before quoting so prices come from the catalogue rather than from memory.",
  risk: "read",
  schema: z.object({ query: z.string().trim().max(100).optional() }),
  summarize: (i) =>
    str(i["query"]) ? `List products matching "${str(i["query"])}"` : "List all products",
};

const listUnpaidInvoices: ActionSpec = {
  name: "list_unpaid_invoices",
  title: "List unpaid invoices",
  description:
    "Invoices with a balance outstanding, oldest first, with how many days overdue each is. Use for chasing payment.",
  risk: "read",
  schema: z.object({ limit: z.number().int().min(1).max(50).optional() }),
  summarize: () => "List invoices still owing money",
};

const businessSnapshot: ActionSpec = {
  name: "business_snapshot",
  title: "Business snapshot",
  description:
    "Headline numbers for the workspace: contacts, open conversations, unpaid invoice total, products. Use to ground advice in this business rather than in generalities.",
  risk: "read",
  schema: z.object({}),
  summarize: () => "Read the workspace's headline numbers",
};

/* ── Writing ──────────────────────────────────────────────────────────────── */

const createContact: ActionSpec = {
  name: "create_contact",
  title: "Create a contact",
  description:
    "Add a new customer. Search first with find_contacts — if they already exist, add a number to the existing record with add_contact_number instead of creating a duplicate.",
  risk: "write",
  schema: z.object({
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().max(40).optional(),
    email: z.string().trim().email().max(200).optional(),
    company: z.string().trim().max(120).optional(),
  }),
  summarize: (i) =>
    `Create contact "${str(i["name"])}"${str(i["phone"]) ? ` (${str(i["phone"])})` : ""}`,
};

const addContactNumber: ActionSpec = {
  name: "add_contact_number",
  title: "Add a number or email to a customer",
  description:
    "Attach another phone number or email address to an existing contact, so messages from it join that customer's history instead of creating a second record. Optionally attribute it to one of their branches.",
  risk: "write",
  schema: z.object({
    contactId: z.string().uuid(),
    kind: z.enum(["phone", "email"]),
    value: z.string().trim().min(3).max(200),
    label: z.string().trim().max(40).optional(),
    branchId: z.string().uuid().optional(),
  }),
  summarize: (i) =>
    `Add ${str(i["kind"]) === "phone" ? "number" : "email"} ${str(i["value"])} to the customer`,
};

const addContactBranch: ActionSpec = {
  name: "add_contact_branch",
  title: "Add a branch",
  description: "Record another location for a customer that trades from more than one place.",
  risk: "write",
  schema: z.object({
    contactId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    city: z.string().trim().max(120).optional(),
    address: z.string().trim().max(300).optional(),
  }),
  summarize: (i) =>
    `Add branch "${str(i["name"])}"${str(i["city"]) ? ` in ${str(i["city"])}` : ""}`,
};

/**
 * The pipeline stages, exactly as the `lead_stage` enum defines them.
 *
 * An earlier list here offered "contacted" -- which the enum does not have, so
 * the update failed at runtime -- and omitted "negotiation", which it does. A
 * cast to `never` at the call site kept the compiler from noticing. The server
 * now casts to this tuple's element type, so a future drift from the generated
 * database types is a compile error instead of a failed customer request.
 */
export const CONTACT_STAGES = ["new", "qualified", "proposal", "negotiation", "won", "lost"] as const;
export type ContactStage = (typeof CONTACT_STAGES)[number];

const setContactStage: ActionSpec = {
  name: "set_contact_stage",
  title: "Move a contact along the pipeline",
  description: "Change which pipeline stage a contact sits in.",
  risk: "write",
  schema: z.object({
    contactId: z.string().uuid(),
    stage: z.enum(CONTACT_STAGES),
  }),
  summarize: (i) => `Move the contact to "${str(i["stage"])}"`,
};

const draftQuotation: ActionSpec = {
  name: "draft_quotation",
  title: "Draft a quotation",
  description:
    "Create a DRAFT quotation for a customer with line items. It is never finalised or numbered by the agent and nothing is sent — a person reviews it in Quotes & Invoices first. Take prices from list_products rather than inventing them.",
  risk: "write",
  schema: z.object({
    contactId: z.string().uuid(),
    items: z
      .array(
        z.object({
          description: z.string().trim().min(1).max(300),
          quantity: z.number().positive().max(100000),
          unitPrice: z.number().min(0).max(10000000),
        }),
      )
      .min(1)
      .max(40),
    notes: z.string().trim().max(2000).optional(),
  }),
  summarize: (i) => {
    const items = Array.isArray(i["items"]) ? i["items"] : [];
    return `Draft a quotation with ${items.length} line${items.length === 1 ? "" : "s"}`;
  },
};

/* ── Sending ──────────────────────────────────────────────────────────────── */

const sendWhatsApp: ActionSpec = {
  name: "send_whatsapp_message",
  title: "Send a WhatsApp message",
  description:
    "Send a WhatsApp message to a contact. Only propose this when the person has clearly asked for a message to go out. Always show the exact wording you intend to send. The message reaches a real customer and cannot be recalled.",
  risk: "send",
  schema: z.object({
    contactId: z.string().uuid(),
    body: z.string().trim().min(1).max(3000),
  }),
  summarize: (i) => {
    const body = str(i["body"]);
    return `Send WhatsApp: "${body.length > 90 ? `${body.slice(0, 90)}…` : body}"`;
  },
};

export const AGENT_ACTIONS: readonly ActionSpec[] = [
  findContacts,
  getContactOverview,
  listProducts,
  listUnpaidInvoices,
  businessSnapshot,
  createContact,
  addContactNumber,
  addContactBranch,
  setContactStage,
  draftQuotation,
  sendWhatsApp,
];

export function actionSpec(name: string): ActionSpec | undefined {
  return AGENT_ACTIONS.find((a) => a.name === name);
}

/** Whether this action may run without a person clicking approve. */
export function isAutoRunnable(name: string): boolean {
  return actionSpec(name)?.risk === "read";
}

/**
 * One proposed step, as it arrives from the model.
 *
 * `input` is unknown here on purpose: it is validated against the specific
 * action's own schema at execution time, not trusted because it parsed as JSON.
 */
export const PlannedStepSchema = z.object({
  action: z.string().min(1).max(60),
  input: z.record(z.string(), z.unknown()).default({}),
  /** The model's own one-line reason, shown to the person deciding. */
  why: z.string().trim().max(300).optional(),
});

export const AgentPlanSchema = z.object({
  /** Plain-language restatement of the task, so a misread is visible up front. */
  understanding: z.string().trim().max(600),
  steps: z.array(PlannedStepSchema).max(12),
  /** What the agent needs the person to tell it before it can proceed. */
  question: z.string().trim().max(400).optional(),
});

export type PlannedStep = z.infer<typeof PlannedStepSchema>;
export type AgentPlan = z.infer<typeof AgentPlanSchema>;

/** A step the server has accepted: known action, valid input, known risk. */
export type ValidatedStep = {
  action: string;
  title: string;
  risk: ActionRisk;
  input: Record<string, JsonValue>;
  summary: string;
  why: string | null;
};

export type RejectedStep = { action: string; reason: string };

/**
 * Checks a model-produced plan against the catalogue.
 *
 * Unknown actions and malformed input are dropped rather than repaired: a plan
 * that half-parsed is a plan the model did not mean, and quietly guessing the
 * missing half is how an agent does something nobody asked for.
 */
export function validatePlan(plan: AgentPlan): {
  steps: ValidatedStep[];
  rejected: RejectedStep[];
} {
  const steps: ValidatedStep[] = [];
  const rejected: RejectedStep[] = [];

  for (const step of plan.steps) {
    const spec = actionSpec(step.action);
    if (!spec) {
      rejected.push({ action: step.action, reason: "There is no such action." });
      continue;
    }
    const parsed = spec.schema.safeParse(step.input);
    if (!parsed.success) {
      rejected.push({
        action: step.action,
        reason: parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
          .join("; "),
      });
      continue;
    }
    const input = parsed.data as Record<string, JsonValue>;
    steps.push({
      action: spec.name,
      title: spec.title,
      risk: spec.risk,
      input,
      summary: spec.summarize(input),
      why: step.why ?? null,
    });
  }
  return { steps, rejected };
}

/** The catalogue as the model sees it. Kept here so it cannot drift. */
export function describeActionsForModel(): string {
  return AGENT_ACTIONS.map((a) => {
    const shape =
      a.schema instanceof z.ZodObject
        ? Object.keys((a.schema as z.ZodObject<z.ZodRawShape>).shape).join(", ") || "(no input)"
        : "(no input)";
    return `- ${a.name} [${a.risk}] — ${a.description}\n  input: ${shape}`;
  }).join("\n");
}
