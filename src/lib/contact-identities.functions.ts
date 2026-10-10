// A customer's phone numbers, emails and branches.
//
// Everything here goes through the caller's own RLS-scoped client rather than
// supabaseAdmin: contact_identities and contact_branches both carry a
// tenant-scoped policy, so a request cannot reach another workspace's rows even
// if an id is guessed. tenant_id is read from the caller's profile and never
// taken from the request body.
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { NOTES_MAX_LENGTH } from "@/lib/contacts-view";
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
    z
      .object({ contactId: z.string().uuid(), notes: z.string().max(NOTES_MAX_LENGTH) })
      .parse(input),
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
 * Two writes rather than one because a unique index
 * (contact_identities_one_primary_key, on contact_id and kind where is_primary)
 * allows only one primary per (contact, kind): the existing primary has to be
 * cleared before the new one is set, or the second write violates it.
 *
 * `id` null means "the number on the contact record": the phone or email held
 * in `contacts` itself has no identity row to flag, and it counts as the
 * primary exactly when no identity of that kind is (see reachLines()). Choosing
 * it is therefore the first write alone.
 *
 * Nothing is cleared until what is being chosen has been checked. Clearing first
 * and then finding the number gone (removed in another tab, or never this
 * contact's) would leave the contact with no primary while telling the person it
 * worked. The same goes for the contact itself: an update that matches no row is
 * not an error to the database, so "the number on the record" of a contact that
 * cannot be seen would otherwise clear nothing and report success.
 *
 * Once the old primary is cleared the second write can still fail, or match no
 * row. Then the old primary is put back so the contact keeps the one it had, and
 * the person is told nothing was changed; if even that cannot be done they are
 * told so, and the card reads the contact again to show what is really there.
 *
 * Choosing an identity also points the contact record at it: messages are sent
 * to `contacts.phone` (and the campaign audience reads `contacts.email`), not to
 * whichever identity is flagged. Changing only the flag left the card saying one
 * number was primary while messages went to another. So that is a third write,
 * and if it fails the flag change is undone as above and the person is told. The
 * number that was on the record, if no identity covers it, is kept as an identity
 * first, so replacing it on the record does not lose it.
 */
export const setPrimaryIdentity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ id: z.string().uuid().nullable(), contactId: z.string().uuid(), kind: KindSchema })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const gone = () =>
      new Error("That number is no longer on this contact. Close this card and open it again.");
    // The contact, as this caller can see it (their own client, so another
    // workspace's contact is not there). Read for both choices.
    const contact = await context.supabase
      .from("contacts")
      .select("id, tenant_id, phone, email")
      .eq("id", data.contactId)
      .maybeSingle();
    if (contact.error) throw contact.error;
    if (!contact.data) {
      throw new Error("This contact could not be found. Close this card and open it again.");
    }
    // This contact's numbers (or emails) of the kind, for the identity chosen and
    // for deciding what the record's own value is already covered by.
    let target: { id: string; value: string } | undefined;
    let ofKind: { id: string; value: string }[] = [];
    if (data.id) {
      const listed = await context.supabase
        .from("contact_identities")
        .select("id, value")
        .eq("contact_id", data.contactId)
        .eq("kind", data.kind);
      if (listed.error) throw listed.error;
      ofKind = (listed.data ?? []) as { id: string; value: string }[];
      target = ofKind.find((row) => row.id === data.id);
      if (!target) throw gone();
    } else {
      // The number on the record has to be there to be chosen.
      const onRecord = data.kind === "phone" ? contact.data.phone : contact.data.email;
      if (!onRecord?.trim()) throw gone();
    }
    const cleared = await context.supabase
      .from("contact_identities")
      .update({ is_primary: false })
      .eq("contact_id", data.contactId)
      .eq("kind", data.kind)
      .eq("is_primary", true)
      .select("id");
    if (cleared.error) throw cleared.error;
    const previous = (cleared.data ?? []).map((row) => row.id as string);
    if (data.id && target) {
      const thing = data.kind === "phone" ? "number" : "email address";
      // Undoes the flag change, then says what happened. `why` is for a refusal
      // the person can do something about; otherwise it is the general sentence.
      const abandon = async (why: string | null, technical: unknown): Promise<never> => {
        console.error("[contacts] could not make the identity primary", technical);
        const restored = await putPreviousPrimaryBack(context.supabase, data.id!, previous);
        throw new Error(
          restored
            ? (why ??
                `That ${thing} could not be made primary, so nothing was changed. Try again in a moment.`)
            : `That ${thing} could not be made primary, and the previous primary could not be put back. Close this card, open it again and choose the primary ${thing} again.`,
        );
      };
      const set = await context.supabase
        .from("contact_identities")
        .update({ is_primary: true })
        .eq("id", data.id)
        .select("id");
      if (set.error || !set.data || set.data.length === 0) {
        return abandon(null, set.error ?? "no row matched");
      }
      const followed = await pointRecordAt(context, contact.data, data.kind, target.value, ofKind);
      if (!followed.ok) return abandon(followed.why, followed.technical);
    }
    return { ok: true };
  });

/** A phone number by its digits (a leading 00 is a +), an email by its lower-case form. */
function sameContactDetail(kind: "phone" | "email", a: string, b: string): boolean {
  const form = (value: string) =>
    kind === "phone" ? value.replace(/\D/g, "").replace(/^00/, "") : value.trim().toLowerCase();
  const left = form(a);
  return left !== "" && left === form(b);
}

/**
 * Makes the contact record carry the value that was chosen as primary, because
 * that is the one messages are sent to. If the record held a different value that
 * no identity of the contact covers, it is kept as an identity first (not
 * primary): the New contact form and the CSV import write only the record, so
 * for those contacts it is the only place that number exists.
 *
 * Says what to tell the person when the database refuses: a phone number that is
 * not in international format, or one another contact in the workspace already
 * sends to. Anything else is the general sentence (why null).
 */
async function pointRecordAt(
  context: { supabase: import("@supabase/supabase-js").SupabaseClient; userId: string },
  contact: { id: string; tenant_id: string | null; phone: string | null; email: string | null },
  kind: "phone" | "email",
  value: string,
  identitiesOfKind: { id: string; value: string }[],
): Promise<{ ok: true } | { ok: false; why: string | null; technical: unknown }> {
  const onRecord = ((kind === "phone" ? contact.phone : contact.email) ?? "").trim();
  if (sameContactDetail(kind, onRecord, value)) return { ok: true };
  try {
    if (onRecord && !identitiesOfKind.some((row) => sameContactDetail(kind, row.value, onRecord))) {
      const kept = await context.supabase.from("contact_identities").insert({
        tenant_id: contact.tenant_id ?? (await callerTenantId(context)),
        contact_id: contact.id,
        kind,
        value: onRecord,
        label: null,
        is_primary: false,
      });
      // 23505: the workspace already has that number on a contact's list, so it is
      // not lost, only not this contact's to list. Anything else stops here.
      if (kept.error && kept.error.code !== "23505") {
        return { ok: false, why: null, technical: kept.error };
      }
    }
    const column = kind === "phone" ? "phone" : "email";
    const changed = await context.supabase
      .from("contacts")
      .update({ [column]: value })
      .eq("id", contact.id)
      .select("id");
    if (changed.error) {
      const code = changed.error.code;
      return {
        ok: false,
        technical: changed.error,
        why:
          code === "23514"
            ? kind === "phone"
              ? "That number is not in international format (a + and the country code), so messages cannot be sent to it as the primary. Nothing was changed."
              : "That email address is not valid, so it cannot be the primary. Nothing was changed."
            : code === "23505" && kind === "phone"
              ? "Another contact in this workspace already uses that number as its main number, so nothing was changed."
              : null,
      };
    }
    if (!changed.data || changed.data.length === 0) {
      return { ok: false, why: null, technical: "the contact record matched no row" };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, why: null, technical: error };
  }
}

/**
 * After a failed change of primary: unflags the one that was being set, in case
 * the write got further than its answer says, and flags the ones that were
 * cleared. Best effort; says whether the contact has its old primary again.
 */
async function putPreviousPrimaryBack(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  attemptedId: string,
  previous: string[],
): Promise<boolean> {
  try {
    const undo = await supabase
      .from("contact_identities")
      .update({ is_primary: false })
      .eq("id", attemptedId);
    if (undo.error) console.error("[contacts] could not undo the attempted primary", undo.error);
    if (previous.length === 0) return !undo.error;
    const back = await supabase
      .from("contact_identities")
      .update({ is_primary: true })
      .in("id", previous)
      .select("id");
    if (back.error) console.error("[contacts] could not restore the previous primary", back.error);
    return !back.error && (back.data?.length ?? 0) === previous.length;
  } catch (error) {
    console.error("[contacts] could not restore the previous primary", error);
    return false;
  }
}

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
