// Switching a workspace's default WhatsApp number, all or nothing.
//
// The default number is what a send uses when a conversation has no number of
// its own. The switch used to be two separate writes -- clear the old default,
// set the new one. When the second write failed, the workspace was left with
// no default at all, and every send that relies on the default stayed broken
// after the database had recovered.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const DEFAULT_NOT_CHANGED = "Could not change the default number. Try again.";
const DEFAULT_NOT_SET = "Could not set that number as the default. Try again.";
const DEFAULT_NEEDS_DATABASE_UPDATE =
  "The default WhatsApp number setting needs a database update from your Flas administrator before it can be changed.";
const NOT_THIS_WORKSPACES_NUMBER = "That number is not connected to this workspace.";

type DatabaseError = { code?: string | null };

/** The database does not have the function yet: its migration has not been applied. */
const functionIsMissing = (error: DatabaseError) =>
  error.code === "PGRST202" || error.code === "42883";

/**
 * Switches the default with two writes, for a database that does not have
 * set_default_wa_number yet.
 *
 * Two writes cannot be made all-or-nothing from here, so when the second one
 * is refused the first is undone: the number that was the default is made the
 * default again.
 */
async function switchInTwoSteps(tenantId: string, numberId: string): Promise<void> {
  const { data: cleared, error: clearError } = await supabaseAdmin
    .from("wa_numbers")
    .update({ is_default: false })
    .eq("tenant_id", tenantId)
    .eq("is_default", true)
    .select("id");
  // Nothing was cleared, so the previous default is still in place.
  if (clearError) throw new Error(DEFAULT_NOT_CHANGED);

  const { error } = await supabaseAdmin
    .from("wa_numbers")
    .update({ is_default: true })
    .eq("id", numberId)
    .eq("tenant_id", tenantId);
  if (!error) return;

  const previous = cleared?.[0];
  if (previous) {
    const { error: restoreError } = await supabaseAdmin
      .from("wa_numbers")
      .update({ is_default: true })
      .eq("id", previous.id)
      .eq("tenant_id", tenantId);
    if (restoreError) {
      console.error(
        "[whatsapp] the default number was cleared and could not be restored; this workspace has no default number",
        restoreError.code ?? "",
      );
    }
  }
  throw new Error(error.code === "23505" ? DEFAULT_NEEDS_DATABASE_UPDATE : DEFAULT_NOT_SET);
}

/**
 * Makes one of a workspace's own numbers its default, and returns that number.
 *
 * Clearing and setting are one database call (set_default_wa_number, from
 * 20261007120000_set_default_wa_number.sql): both happen or neither does, so
 * a failure leaves the previous default exactly as it was. That migration is
 * applied by hand, separately from the code. Until it has been, the database
 * answers "no such function" and the switch is made in two steps that undo
 * themselves on failure.
 *
 * `tenantId` is the caller's own workspace, from their profile. `requestedId`
 * is whatever the browser sent, so it is checked against that workspace first.
 */
export async function switchDefaultWhatsAppNumber(
  tenantId: string,
  requestedId: string,
): Promise<{ id: string }> {
  const { data: number, error: numberError } = await supabaseAdmin
    .from("wa_numbers")
    .select("id, is_default")
    .eq("id", requestedId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  // "Could not read it" is not "it is someone else's".
  if (numberError) throw new Error(DEFAULT_NOT_CHANGED);
  if (!number) throw new Error(NOT_THIS_WORKSPACES_NUMBER);

  const switched = await supabaseAdmin.rpc(
    "set_default_wa_number" as never,
    { _tenant_id: tenantId, _number_id: number.id } as never,
  );
  if (!switched.error) {
    // It answers with the number that is now the default. Anything else is
    // not a switch this can vouch for.
    if ((switched.data as unknown) !== number.id) throw new Error(DEFAULT_NOT_CHANGED);
    return { id: number.id };
  }
  if (!functionIsMissing(switched.error)) {
    // The function is there and refused: nothing was changed, and nothing
    // else is tried.
    const code = (switched.error as DatabaseError).code;
    if (code === "P0002") throw new Error(NOT_THIS_WORKSPACES_NUMBER);
    throw new Error(code === "23505" ? DEFAULT_NEEDS_DATABASE_UPDATE : DEFAULT_NOT_CHANGED);
  }

  // Already the default: there is nothing to switch. It used to be cleared in
  // order to be set again, and was lost when that second write failed.
  if (!number.is_default) await switchInTwoSteps(tenantId, number.id);
  return { id: number.id };
}
