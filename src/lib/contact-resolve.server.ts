// One place that answers "whose number is this?".
//
// It existed twice, differently: the WhatsApp webhook asked the database to
// normalize the number (so "+971 50 123 4567" and "971501234567" find the same
// customer), while the template send compared the raw string. A contact saved
// in any other format was therefore "not a saved contact" on the send path --
// which, now that a template without recorded consent is refused, turned a
// formatting difference into a blocked message.
//
// Normalization itself belongs in the database, not here: one canonical form
// shared by the webhook, the widget and any importer. See the migration
// 20260925120000_phone_identity_one_canonical_form.sql.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ResolvedContact = { contactId: string; branchId: string | null } | null;

/**
 * Finds the contact a phone number belongs to, within one workspace.
 *
 * The identities table is the index; `contacts.phone` is still read as a
 * fallback for any contact the identities backfill did not cover (one created
 * between that migration and the deploy after it).
 */
export async function resolveContactByPhone(
  tenantId: string,
  phone: string | null | undefined,
): Promise<ResolvedContact> {
  if (!tenantId || !phone) return null;

  const { data: resolved } = await supabaseAdmin.rpc("resolve_contact_by_identity", {
    _tenant_id: tenantId,
    _kind: "phone",
    _value: phone,
  });
  const hit = (Array.isArray(resolved) ? resolved[0] : resolved) as
    { contact_id?: string; branch_id?: string | null } | null | undefined;
  if (hit?.contact_id) return { contactId: hit.contact_id, branchId: hit.branch_id ?? null };

  const { data: existing } = await supabaseAdmin
    .from("contacts")
    .select("id")
    .eq("phone", phone)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return existing?.id ? { contactId: existing.id, branchId: null } : null;
}
