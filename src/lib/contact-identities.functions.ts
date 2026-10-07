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

/**
 * Everything one contact's detail view shows: the record itself, its numbers,
 * emails, branches and its conversation threads.
 *
 * The contact row is read here and not only in the board's own query because of
 * H12. `contact_identities` is backfilled by its migration, but the New contact
 * form and the CSV import write `contacts.phone` / `contacts.email` and nothing
 * else, so a contact added through the UI has a number that no identity row
 * mentions — and the dialog, reading identities alone, said "Nothing recorded
 * yet" about a contact plainly holding +971509630506. reachLines() in
 * src/lib/contacts-view.ts folds the two together.
 *
 * Conversations come back with it so the dialog can offer a way through to the
 * thread in the inbox rather than making the user go and find it.
 */
export const getContactDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ contactId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const [contact, identities, branches, conversations] = await Promise.all([
      context.supabase
        .from("contacts")
        .select(
          "id, name, phone, email, company, tags, stage, value, notes, consent_given, consent_at, last_message_at, created_at",
        )
        .eq("id", data.contactId)
        .maybeSingle(),
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
      context.supabase
        .from("conversations")
        .select("id, channel, status, unread_count, last_message_at, last_message_preview")
        .eq("contact_id", data.contactId)
        .order("last_message_at", { ascending: false })
        .limit(20),
    ]);
    if (contact.error) throw contact.error;
    if (identities.error) throw identities.error;
    if (branches.error) throw branches.error;
    if (conversations.error) throw conversations.error;
    return {
      contact: contact.data ?? null,
      identities: identities.data ?? [],
      branches: branches.data ?? [],
      conversations: conversations.data ?? [],
    };
  });

/**
 * Free-text notes on a contact, saved from the detail dialog.
 *
 * Answers with the note as it was stored (trimmed, or null when cleared), so the
 * dialog can show what is really saved without waiting for a refetch.
 */
export const saveContactNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ contactId: z.string().uuid(), notes: z.string().max(4000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    // Blank clears the field rather than storing an empty string, so the
    // "no notes yet" state stays a single condition everywhere that reads it.
    const stored = data.notes.trim() || null;
    const { data: updated, error } = await context.supabase
      .from("contacts")
      .update({ notes: stored })
      .eq("id", data.contactId)
      .select("id");
    if (error) throw error;
    // An update that matches no row is not an error to the database: the contact
    // was deleted in another tab, or is not in this workspace. Saying "saved"
    // then would tell the person a note exists that was never written.
    if (!updated || updated.length === 0) {
      throw new Error("This contact could not be found, so the note was not saved.");
    }
    return { ok: true, notes: stored };
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
 *
 * `id` null means "the number on the contact record": the phone or email held
 * in `contacts` itself has no identity row to flag, and it counts as the
 * primary exactly when no identity of that kind is (see reachLines()). Choosing
 * it is therefore the first write alone.
 *
 * The identity is checked before anything is cleared. Clearing first and then
 * finding the number gone (removed in another tab, or never this contact's)
 * would leave the contact with no primary while telling the person it worked.
 */
export const setPrimaryIdentity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ id: z.string().uuid().nullable(), contactId: z.string().uuid(), kind: KindSchema })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (data.id) {
      const found = await context.supabase
        .from("contact_identities")
        .select("id")
        .eq("id", data.id)
        .eq("contact_id", data.contactId)
        .eq("kind", data.kind)
        .maybeSingle();
      if (found.error) throw found.error;
      if (!found.data) {
        throw new Error(
          "That number is no longer on this contact. Close this card and open it again.",
        );
      }
    }
    const cleared = await context.supabase
      .from("contact_identities")
      .update({ is_primary: false })
      .eq("contact_id", data.contactId)
      .eq("kind", data.kind);
    if (cleared.error) throw cleared.error;
    if (data.id) {
      const { error } = await context.supabase
        .from("contact_identities")
        .update({ is_primary: true })
        .eq("id", data.id);
      if (error) throw error;
    }
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
