import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

/**
 * Server-side resend of Supabase auth emails, with per-email AND per-IP rate
 * limits enforced in the DB (`check_otp_attempt` RPC).  Every attempt is
 * recorded in `otp_attempts` for super-admin visibility.
 *
 * Kinds:
 *   - signup_verify    — resend the confirm-email link for a not-yet-verified user
 *   - password_recovery — send a password reset link
 *   - magic_link       — send a magic sign-in link
 */
const InputSchema = z.object({
  email: z.string().email().max(320),
  kind: z.enum(["signup_verify", "password_recovery", "magic_link"]),
  redirectTo: z.string().url().optional(),
});

function normalizeIp(req: Request | undefined): string {
  if (!req) return "0.0.0.0";
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  return "0.0.0.0";
}

export const resendVerification = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    // Uses service-role client — bypasses RLS so the anonymous user (no
    // session yet) can still trigger a resend on their own address.  The
    // rate-limit RPC below prevents this from becoming a mail cannon.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const req = (() => {
      try {
        return getRequest();
      } catch {
        return undefined;
      }
    })();
    const ip = normalizeIp(req);
    const email = data.email.trim().toLowerCase();

    // 1. Rate limit check. Per address: 60s cooldown, 5/hour, 20/day.
    //    Per source IP across all addresses: 20/hour, 100/day -- the IP was
    //    being recorded but never checked, so one host could cycle through
    //    unlimited addresses and burn the sending domain's reputation.
    const { data: gate, error: gateErr } = await supabaseAdmin.rpc("check_otp_attempt", {
      _email: email,
      _kind: data.kind,
      _ip: ip,
    });
    if (gateErr) {
      // Record the failure so super-admin can see something went wrong
      await supabaseAdmin.rpc("record_otp_attempt", {
        _email: email,
        _ip: ip,
        _kind: data.kind,
        _status: "rejected",
        _reject_reason: "error",
      });
      throw new Error("Could not check rate limit — try again shortly");
    }
    const row = Array.isArray(gate) ? gate[0] : gate;
    if (row && !row.allowed) {
      await supabaseAdmin.rpc("record_otp_attempt", {
        _email: email,
        _ip: ip,
        _kind: data.kind,
        _status: "rejected",
        _reject_reason: row.reject_reason,
      });
      if (row.reject_reason === "cooldown") {
        throw new Error(`Please wait ${row.seconds_until_next}s before requesting another email.`);
      }
      if (row.reject_reason === "max_attempts_hour") {
        throw new Error("Too many attempts in the last hour. Try again later.");
      }
      if (row.reject_reason === "ip_max_attempts_hour") {
        throw new Error("Too many requests from this network in the last hour. Try again later.");
      }
      if (row.reject_reason === "ip_max_attempts_day") {
        throw new Error("Too many requests from this network today. Try again tomorrow.");
      }
      throw new Error("Too many attempts. Try again tomorrow.");
    }

    // 2. Record as "requested" — flipped to "sent" once Supabase confirms
    const { data: attemptId } = await supabaseAdmin.rpc("record_otp_attempt", {
      _email: email,
      _ip: ip,
      _kind: data.kind,
      _status: "requested",
      _reject_reason: null as unknown as string,
    });

    // 3. Actually dispatch via Supabase Auth's admin API
    try {
      let sendResult: { data: unknown; error: unknown };
      if (data.kind === "signup_verify") {
        sendResult = await supabaseAdmin.auth.resend({
          type: "signup",
          email,
          ...(data.redirectTo ? { options: { emailRedirectTo: data.redirectTo } } : {}),
        });
      } else if (data.kind === "password_recovery") {
        sendResult = await supabaseAdmin.auth.resetPasswordForEmail(
          email,
          data.redirectTo ? { redirectTo: data.redirectTo } : undefined,
        );
      } else {
        // magic_link
        sendResult = await supabaseAdmin.auth.signInWithOtp({
          email,
          ...(data.redirectTo ? { options: { emailRedirectTo: data.redirectTo } } : {}),
        });
      }

      const err = (sendResult as { error?: { message?: string } | null }).error;
      if (err) throw new Error(err.message ?? "Send failed");

      // 4. Log the delivery + flip attempt to 'sent'
      const { data: tenantIdRow } = await supabaseAdmin
        .from("profiles")
        .select("tenant_id")
        .eq("email", email)
        .maybeSingle();
      await supabaseAdmin.rpc("log_email_delivery", {
        _tenant_id: tenantIdRow?.tenant_id ?? null,
        _user_id: null,
        _recipient: email,
        _from_address: null,
        _subject: null,
        _template:
          data.kind === "signup_verify"
            ? "signup"
            : data.kind === "password_recovery"
              ? "recovery"
              : "magic_link",
        _provider: "supabase",
        _provider_msg_id: attemptId as unknown as string,
        _status: "sent",
        _error: null,
        _meta: { ip },
      });
      return { ok: true };
    } catch (e) {
      await supabaseAdmin.rpc("record_otp_attempt", {
        _email: email,
        _ip: ip,
        _kind: data.kind,
        _status: "rejected",
        _reject_reason: e instanceof Error ? e.message.slice(0, 200) : "error",
      });
      // Uniform error to prevent account-existence enumeration
      throw new Error("If an account exists for this email, a message has been sent.");
    }
  });
