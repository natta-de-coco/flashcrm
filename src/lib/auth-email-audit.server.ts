type AuthEmailAction = "signup" | "recovery";

export async function recordAuthEmailOutcome(input: {
  recipientEmail: string;
  actionType: AuthEmailAction;
  accepted: boolean;
  providerError?: string;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const recipientEmail = input.recipientEmail.trim().toLowerCase();

  const [{ data: profile }, { count }] = await Promise.all([
    supabaseAdmin.from("profiles").select("tenant_id").eq("email", recipientEmail).maybeSingle(),
    supabaseAdmin
      .from("auth_email_attempts")
      .select("id", { count: "exact", head: true })
      .eq("recipient_email", recipientEmail)
      .eq("action_type", input.actionType)
      .gte("requested_at", new Date(Date.now() - 60 * 60 * 1000).toISOString()),
  ]);

  const now = new Date().toISOString();
  const { error } = await supabaseAdmin.from("auth_email_attempts").insert({
    tenant_id: profile?.tenant_id ?? null,
    recipient_email: recipientEmail,
    action_type: input.actionType,
    status: input.accepted ? "accepted" : "rejected",
    attempt_number: (count ?? 0) + 1,
    provider_error: input.providerError?.slice(0, 500) ?? null,
    requested_at: now,
    accepted_at: input.accepted ? now : null,
  });

  if (error) {
    console.error("[Auth email audit] Could not record outcome", {
      code: error.code,
      message: error.message,
      actionType: input.actionType,
    });
  }
}
