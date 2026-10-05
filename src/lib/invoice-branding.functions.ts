import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const uploadInvoiceLogo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ image: z.string().max(2_800_000) }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: profile, error: profileError } = await context.supabase
      .from("profiles")
      .select("tenant_id, staff_role")
      .eq("id", context.userId)
      .maybeSingle();
    if (
      profileError ||
      !profile?.tenant_id ||
      !["company_admin", "super_admin"].includes(profile.staff_role)
    )
      throw new Error("Only a company admin can change the invoice logo.");
    const tenantId = profile.tenant_id as string;
    const { decodeInvoiceLogo } = await import("@/lib/invoice-logo.server");
    const image = await decodeInvoiceLogo(data.image);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { ensureBillingSettings } = await import("@/lib/billing.server");
    const settings = await ensureBillingSettings(supabaseAdmin, tenantId);
    if (!settings) throw new Error("Could not prepare your company's invoice settings.");
    // Immutable path: replacing a logo cannot alter a previously issued invoice.
    const path = `${tenantId}/${crypto.randomUUID()}.${image.extension}`;
    const bucket = supabaseAdmin.storage.from("company-branding");
    const { error: uploadError } = await bucket.upload(path, image.bytes, {
      contentType: image.contentType,
      cacheControl: "31536000",
      upsert: false,
    });
    if (uploadError)
      throw new Error("Logo upload failed. Check that company branding storage has been set up.");
    const { data: asset } = bucket.getPublicUrl(path);
    const { error } = await supabaseAdmin
      .from("billing_settings")
      .update({ logo_url: asset.publicUrl, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId);
    if (error) {
      await bucket.remove([path]);
      throw new Error("The logo could not be saved. Your previous logo is unchanged.");
    }
    const { logAudit } = await import("@/lib/audit.server");
    await logAudit({
      action: "billing.logo_uploaded",
      tenantId,
      actorId: context.userId,
      entityType: "billing_settings",
      entityId: tenantId,
      details: { contentType: image.contentType, bytes: image.bytes.length },
    });
    return { logoUrl: asset.publicUrl };
  });
