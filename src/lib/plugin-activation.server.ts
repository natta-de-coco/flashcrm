import { supabaseAdmin } from "@/integrations/supabase/client.server";

type ActivationInput = {
  siteId: string;
  origin: string;
  domain: string | null;
  adminEmail: string | null;
  platform: string;
};

const MAX_ACTIVATION_ATTEMPTS_PER_HOUR = 3;

/** Counts recent activation requests for this site via the audit log (no new table needed). */
async function recentActivationAttempts(siteId: string): Promise<number> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await supabaseAdmin
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("action", "plugin.activation_requested")
    .eq("entity_id", siteId)
    .gte("created_at", since);
  // A count that failed used to read as "no attempts yet", which let every
  // request through for as long as the database was struggling.
  if (error) throw new Error(`Could not check recent activation attempts: ${error.message}`);
  return count ?? 0;
}

/** Records a plugin activation attempt and returns the current state for the plugin to display. */
export async function requestSiteActivation(input: ActivationInput): Promise<{
  status: "active" | "pending" | "revoked" | "rate_limited";
  message: string;
}> {
  const { data: site, error } = await supabaseAdmin
    .from("lead_sites")
    .select("id, tenant_id, status, activation_token, admin_email, domain")
    .eq("id", input.siteId)
    .single();
  if (error || !site) throw new Error("Site not found");

  if (site.status === "revoked") {
    return { status: "revoked", message: "This site was revoked. Contact your Flas CRM admin." };
  }

  if ((await recentActivationAttempts(site.id)) >= MAX_ACTIVATION_ATTEMPTS_PER_HOUR) {
    return {
      status: "rate_limited",
      message: "Too many activation attempts for this site. Try again in an hour.",
    };
  }

  // The admin email is a one-time claim, not something any caller with the
  // (public) site key can keep overriding. Once a site has a registered
  // admin_email, every later activation attempt sends there — never to
  // whatever address this particular request happens to supply. Without
  // this, anyone who knew the site key could redirect activation emails (and
  // real emails from your domain) to an address of their choosing.
  //
  // An active site that has no address on file does not take one from here
  // either: it used to accept the first one offered, which is the same claim
  // made by the same unknown caller.
  const locked = site.status === "active";
  const adminEmail = site.admin_email ?? (locked ? null : input.adminEmail) ?? null;

  // The domain and platform are claimed the same way, and for the same reason.
  // The site key lives in public website code, so anyone who reads it could
  // otherwise point an already-active site at a domain of their own: lead
  // collection breaks, and the origin check starts trusting the wrong site.
  // Before activation these are still being set up, so a pending site may
  // still change them; an active one may not, and a workspace admin changes
  // them from inside FLAS instead.
  //
  // That includes an active site whose domain was never set (one that went
  // live before it reported a domain, or before domains were recorded at all).
  // It stays unpinned here, and checkDomainPin accepts every origin for it,
  // which is a gap -- but nothing this endpoint is sent proves who is calling,
  // so "the first domain offered" would hand the pin to whoever asked first.
  // Closing the gap needs a signed-in admin to set the domain.
  const domain = locked ? site.domain : (input.domain ?? site.domain);
  const platform = locked ? undefined : input.platform;

  const { error: saveError } = await supabaseAdmin
    .from("lead_sites")
    .update({
      domain,
      admin_email: adminEmail,
      ...(platform ? { platform } : {}),
    })
    .eq("id", site.id);
  // An update that failed used to be ignored: the email still went out and the
  // plugin was told it had, for a site whose address and domain were not saved.
  if (saveError) throw new Error(`Could not save the site's details: ${saveError.message}`);

  const { logAudit } = await import("@/lib/audit.server");
  await logAudit({
    action: "plugin.activation_requested",
    tenantId: site.tenant_id,
    entityType: "lead_site",
    entityId: site.id,
    details: { platform: input.platform },
  });

  if (site.status === "active") {
    return { status: "active", message: "This site is already activated." };
  }

  const link = `${input.origin}/api/public/plugin/activate?token=${site.activation_token}`;
  const sendResult =
    adminEmail && site.tenant_id
      ? await sendActivationEmail(
          site.tenant_id,
          adminEmail,
          link,
          input.domain ?? site.domain ?? "your website",
        )
      : { ok: false, error: "no admin email on file" };

  return {
    status: "pending",
    message: !adminEmail
      ? "Add an activation email address, then save again."
      : sendResult.ok
        ? `Activation email sent to ${adminEmail}. Click the link in it to go live.`
        : `Could not send the activation email (${sendResult.error}). Use the link from your CRM's Downloads page instead, or fix email settings and try again.`,
  };
}

/** Consumes an activation token from the emailed link. */
export async function activateSiteByToken(
  token: string,
): Promise<{ ok: boolean; message: string }> {
  const { data: site } = await supabaseAdmin
    .from("lead_sites")
    .select("id, name, status")
    .eq("activation_token", token)
    .maybeSingle();

  if (!site) return { ok: false, message: "This activation link is no longer valid." };
  if (site.status === "revoked") {
    return { ok: false, message: "This site was revoked by a Flas CRM admin." };
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
    message: `${site.name} is live. The chatbot popup now sends leads straight into Flas CRM.`,
  };
}

/**
 * Sends the activation email through the tenant's configured email provider
 * (falling back to the platform-wide one). A previous version of this
 * function only ever logged the link with console.info and always reported
 * success — the entire activation-by-email flow was inert in production.
 */
async function sendActivationEmail(
  tenantId: string,
  to: string,
  link: string,
  domain: string,
): Promise<{ ok: boolean; error?: string }> {
  const { sendTenantEmail } = await import("@/lib/email-dispatch.server");
  const result = await sendTenantEmail(tenantId, {
    to,
    subject: `Activate ${domain} on Flas CRM`,
    text: `Click the link below to finish connecting ${domain} to Flas CRM:\n\n${link}\n\nIf you didn't request this, you can ignore this email.`,
  });
  if (!result.ok)
    console.error(`[plugin] activation email to ${to} for ${domain} failed:`, result.error);
  return result;
}
