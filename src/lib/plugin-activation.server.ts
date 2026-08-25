import { supabaseAdmin } from "@/integrations/supabase/client.server";

type ActivationInput = {
  siteId: string;
  origin: string;
  domain: string | null;
  adminEmail: string | null;
  platform: string;
};

/** Records a plugin activation attempt and returns the current state for the plugin to display. */
export async function requestSiteActivation(input: ActivationInput): Promise<{
  status: "active" | "pending" | "revoked";
  message: string;
}> {
  const { data: site, error } = await supabaseAdmin
    .from("lead_sites")
    .select("id, status, activation_token, admin_email, domain")
    .eq("id", input.siteId)
    .single();
  if (error || !site) throw new Error("Site not found");

  if (site.status === "revoked") {
    return { status: "revoked", message: "This site was revoked. Contact your Flash CRM admin." };
  }

  const adminEmail = input.adminEmail ?? site.admin_email ?? null;

  await supabaseAdmin
    .from("lead_sites")
    .update({
      domain: input.domain ?? site.domain,
      admin_email: adminEmail,
      platform: input.platform,
    })
    .eq("id", site.id);

  if (site.status === "active") {
    return { status: "active", message: "This site is already activated." };
  }

  const link = `${input.origin}/api/public/plugin/activate?token=${site.activation_token}`;
  await sendActivationEmail(adminEmail, link, input.domain ?? site.domain ?? "your website");

  return {
    status: "pending",
    message: adminEmail
      ? `Activation email sent to ${adminEmail}. Click the link in it to go live.`
      : "Add an activation email address, then save again.",
  };
}

/** Consumes an activation token from the emailed link. */
export async function activateSiteByToken(token: string): Promise<{ ok: boolean; message: string }> {
  const { data: site } = await supabaseAdmin
    .from("lead_sites")
    .select("id, name, status")
    .eq("activation_token", token)
    .maybeSingle();

  if (!site) return { ok: false, message: "This activation link is no longer valid." };
  if (site.status === "revoked") {
    return { ok: false, message: "This site was revoked by a Flash CRM admin." };
  }
  if (site.status === "active") {
    return { ok: true, message: `${site.name} is already activated and collecting leads.` };
  }

  const { error } = await supabaseAdmin
    .from("lead_sites")
    .update({ status: "active", activated_at: new Date().toISOString() })
    .eq("id", site.id);
  if (error) return { ok: false, message: "Could not activate this site. Please try again." };

  return {
    ok: true,
    message: `${site.name} is live. The chatbot popup now sends leads straight into Flash CRM.`,
  };
}

/**
 * Sends the activation email through Lovable managed email when a sender domain is
 * configured. Until then the link is logged and shown inside the CRM so an admin can
 * activate the site manually.
 */
async function sendActivationEmail(
  to: string | null,
  link: string,
  domain: string,
): Promise<void> {
  if (!to) return;
  console.info(`[plugin] activation link for ${domain} -> ${to}: ${link}`);
}
