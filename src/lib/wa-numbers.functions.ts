// Adding a WhatsApp number, on the server.
//
// A number's access token and app secret used to be inserted straight from the
// browser, so they were stored exactly as typed: never encrypted, unlike every
// other credential in FLAS. They are now sealed here, written with the service
// role after an admin check, for the workspace taken from the caller's own
// profile -- never from anything the browser sends.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireCompanyAdmin } from "@/lib/platform-apps.functions";
import { z } from "zod";

export const WhatsAppNumberSchema = z.object({
  label: z.string().trim().min(1, "Give the number a name").max(80),
  displayPhone: z.string().trim().max(40).optional(),
  // Meta's phone number ID is the long number shown in WhatsApp Manager, not
  // the phone number itself.
  phoneNumberId: z
    .string()
    .trim()
    .regex(/^\d{6,30}$/, "Use the numeric phone number ID from WhatsApp Manager"),
  accessToken: z.string().trim().min(20, "The access token looks incomplete").max(2000),
  appSecret: z.string().trim().min(16, "The app secret looks incomplete").max(200).optional(),
});

export const addWhatsAppNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => WhatsAppNumberSchema.parse(input))
  .handler(async ({ data, context }) => {
    const tenantId = await requireCompanyAdmin(context);

    // Same rule as provider sign-in credentials: nothing new is stored in the
    // clear. A token that cannot be sealed is refused, not saved as typed.
    const { encryptionConfigured, sealSecret } = await import("@/lib/secret-box.server");
    if (!(await encryptionConfigured())) {
      throw new Error(
        "WhatsApp numbers cannot be added until secure token storage is set up. Ask your Flas administrator to finish setup.",
      );
    }
    const accessToken = await sealSecret(data.accessToken);
    const appSecret = data.appSecret ? await sealSecret(data.appSecret) : null;
    if (!accessToken || (data.appSecret && !appSecret)) {
      throw new Error("The credentials could not be secured, so nothing was saved.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Inbound messages are routed by this ID. The same number active in two
    // workspaces would make that routing ambiguous, so it is refused here.
    const { data: existing, error: lookupError } = await supabaseAdmin
      .from("wa_numbers")
      .select("id, tenant_id")
      .eq("phone_number_id", data.phoneNumberId)
      .eq("active", true);
    if (lookupError) throw new Error("Could not check whether this number is already connected.");
    if ((existing ?? []).length > 0) {
      throw new Error(
        (existing ?? []).some((row) => row.tenant_id === tenantId)
          ? "This WhatsApp number is already connected to this workspace."
          : "This WhatsApp number is already connected to another workspace.",
      );
    }

    const { count, error: countError } = await supabaseAdmin
      .from("wa_numbers")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId);
    if (countError) throw new Error("Could not check this workspace's numbers.");

    const { data: row, error } = await supabaseAdmin
      .from("wa_numbers")
      .insert({
        tenant_id: tenantId,
        label: data.label,
        display_phone: data.displayPhone || null,
        phone_number_id: data.phoneNumberId,
        access_token: accessToken,
        ...(appSecret ? { app_secret: appSecret } : {}),
        is_default: (count ?? 0) === 0,
      })
      .select("id")
      .single();
    if (error || !row) throw new Error("The number could not be saved.");

    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "whatsapp.number_added",
      tenantId,
      actorId: context.userId,
      entityType: "wa_number",
      entityId: row.id,
      details: { phoneNumberId: data.phoneNumberId, appSecretSaved: Boolean(appSecret) },
    });
    return { id: row.id };
  });
