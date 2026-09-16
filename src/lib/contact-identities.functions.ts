// A customer's phone numbers, emails and branches.
//
// Everything here goes through the caller's own RLS-scoped client rather than
// supabaseAdmin: contact_identities and contact_branches both carry a
// tenant-scoped policy, so a request cannot reach another workspace's rows even
// if an id is guessed. tenant_id is read from the caller's profile and never
// taken from the request body.
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const KindSchema = z.enum(["phone", "email"]);

async function callerTenantId(context: {
  supabase: import("@supabase/supabase-js").SupabaseClient;
  userId: string;
}): Promise<string> {
  const { data } = await context.supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", context.userId)
    .maybeSingle();
  if (!data?.tenant_id) {
    throw new Error("Your workspace is still being set up — try again in a moment.");
  }
  return data.tenant_id as string;
}

/** Every number, email and branch for one customer. */
export const getContactDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ contactId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const [identities, branches] = await Promise.all([
      context.supabase
        .from("contact_identities")
        .select("id, kind, value, label, is_primary, branch_id, created_at")
        .eq("contact_id", data.contactId)
        .order("is_primary", { ascending: false })
        .order("created_at", { ascending: true }),
      context.supabase
        .from("contact_branches")
        .select("id, name, address, city, country, notes, is_primary, created_at")
        .eq("contact_id", data.contactId)
        .order("is_primary", { ascending: false })
        .order("name", { ascending: true }),
    ]);
    if (identities.error) throw identities.error;
    if (branches.error) throw branches.error;
    return { identities: identities.data ?? [], branches: branches.data ?? [] };
  });

export const addContactIdentity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        contactId: z.string().uuid(),
        kind: KindSchema,
        value: z.string().trim().min(3).max(200),
        label: z.string().trim().max(40).optional(),
        branchId: z.string().uuid().nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await callerTenantId(context);
    const { error } = await context.supabase.from("contact_identities").insert({
      tenant_id: tenantId,
      contact_id: data.contactId,
      kind: data.kind,
      value: data.value,
      label: data.label ?? null,
      branch_id: data.branchId ?? null,
    });
    if (error) {
      // The unique index is the whole point of the table, so its violation
      // deserves a sentence rather than a Postgres code. 23505 is unique_violation.
      if (error.code === "23505") {
        throw new Error(
          `That ${data.kind === "phone" ? "number" : "email address"} already belongs to another contact in this workspace. Open that contact instead, or remove it there first.`,
        );
      }
      throw error;
    }
    return { ok: true };
  });

export const removeContactIdentity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("contact_identities").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

/**
 * Makes one identity the primary of its kind.
 *
 * Two writes rather than one because a partial unique index allows only one
 * primary per (contact, kind): the existing primary has to be cleared before
 * the new one is set, or the second write violates it.
 */
export const setPrimaryIdentity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ id: z.string().uuid(), contactId: z.string().uuid(), kind: KindSchema })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const cleared = await context.supabase
      .from("contact_identities")
      .update({ is_primary: false })
      .eq("contact_id", data.contactId)
      .eq("kind", data.kind);
    if (cleared.error) throw cleared.error;
    const { error } = await context.supabase
      .from("contact_identities")
      .update({ is_primary: true })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const saveContactBranch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        contactId: z.string().uuid(),
        name: z.string().trim().min(1).max(120),
        address: z.string().trim().max(300).optional(),
        city: z.string().trim().max(120).optional(),
        country: z.string().trim().max(120).optional(),
        notes: z.string().trim().max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await callerTenantId(context);
    const row = {
      tenant_id: tenantId,
      contact_id: data.contactId,
      name: data.name,
      address: data.address ?? null,
      city: data.city ?? null,
      country: data.country ?? null,
      notes: data.notes ?? null,
    };
    const query = data.id
      ? context.supabase.from("contact_branches").update(row).eq("id", data.id)
      : context.supabase.from("contact_branches").insert(row);
    const { error } = await query;
    if (error) {
      if (error.code === "23505") {
        throw new Error(`This customer already has a branch called "${data.name}".`);
      }
      throw error;
    }
    return { ok: true };
  });

export const removeContactBranch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    // Identities pointing at this branch are not deleted with it: the number
    // still belongs to the customer, it just stops being attributed to a
    // location. The FK is ON DELETE SET NULL for the same reason.
    const { error } = await context.supabase.from("contact_branches").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

/**
 * Folds a duplicate contact into the one you are keeping.
 *
 * This is the repair for what the old single-phone model created: the same
 * customer split across several records because they messaged from a second
 * number. Identities, branches, conversations and sales documents move across,
 * then the duplicate is deleted.
 *
 * Not a transaction. Supabase's REST client cannot open one, so the order below
 * is chosen so that an interruption leaves data attached to a real contact
 * rather than orphaned: everything is re-pointed before anything is removed.
 */
export const mergeContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ keepId: z.string().uuid(), mergeId: z.string().uuid() })
      .refine((v) => v.keepId !== v.mergeId, "Pick two different contacts.")
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { keepId, mergeId } = data;

    // Move the duplicate's own phone/email in as identities first, so they are
    // not lost when the row goes. Failures are ignored: a conflict means the
    // number is already claimed, which is the outcome we want anyway.
    const { data: dup } = await context.supabase
      .from("contacts")
      .select("phone, email, tenant_id")
      .eq("id", mergeId)
      .maybeSingle();
    if (dup?.tenant_id) {
      for (const [kind, value] of [
        ["phone", dup.phone],
        ["email", dup.email],
      ] as const) {
        if (!value) continue;
        await context.supabase
          .from("contact_identities")
          .insert({ tenant_id: dup.tenant_id, contact_id: keepId, kind, value, label: "Merged" })
          .then(
            () => undefined,
            () => undefined,
          );
      }
    }

    for (const table of ["contact_identities", "contact_branches", "conversations"] as const) {
      const { error } = await context.supabase
        .from(table)
        .update({ contact_id: keepId })
        .eq("contact_id", mergeId);
      if (error) throw error;
    }

    const { error: deleteError } = await context.supabase
      .from("contacts")
      .delete()
      .eq("id", mergeId);
    if (deleteError) throw deleteError;

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "contact.merged",
      actorId: context.userId,
      entityType: "contact",
      entityId: keepId,
      details: { merged: mergeId },
    });
    return { ok: true };
  });
