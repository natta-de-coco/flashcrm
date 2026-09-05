import { FlasWordmark } from "@/components/FlashLogoBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";

import { supabase } from "@/integrations/supabase/client";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Flas CRM" },
      { name: "description", content: "Sign in to the Flas CRM WhatsApp team inbox." },
      { property: "og:title", content: "Sign in — Flas CRM" },
      { property: "og:description", content: "Access your WhatsApp inbox, contacts and chatbot." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search['redirect'] === "string" ? { redirect: search['redirect'] as string } : {},
  component: AuthPage,
});

/** Only same-origin relative paths may be used as a post-login destination. */
function safePath(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/inbox";
  return value;
}

function AuthPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const dest = safePath(search.redirect);
  const { session } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  // Two-factor step: set when the account has TOTP enabled.
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [forgotOpen, setForgotOpen] = useState(false);
  const [verificationPending, setVerificationPending] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const resendAttempts = useRef(0);

  useEffect(() => {
    if (session) navigate({ to: dest });
  }, [session, navigate, dest]);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setResendSeconds((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setBusy(false);
      toast.error(error.message);
      return;
    }
    // If the account has 2FA enabled, the session starts at AAL1 — require the code.
    const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    setBusy(false);
    if (aal.data?.nextLevel === "aal2" && aal.data.currentLevel !== "aal2") {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const factor = (factors?.totp ?? []).find((f) => f.status === "verified");
      if (factor) {
        setMfaFactorId(factor.id);
        return;
      }
    }
    navigate({ to: dest });
  }

  async function requestPasswordReset(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      toast.error("Enter your email address first.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("If an account exists, a password reset link has been sent.");
    setForgotOpen(false);
  }

  async function resendVerification() {
    if (!email.trim() || resendSeconds > 0 || resendAttempts.current >= 5) return;
    setBusy(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}${dest}` },
    });
    setBusy(false);
    resendAttempts.current += 1;
    setResendSeconds(60);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("A new verification email has been sent.");
  }

  async function verifyMfa(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaFactorId) return;
    setBusy(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: mfaFactorId,
      code: mfaCode.trim(),
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    navigate({ to: dest });
  }

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${window.location.origin}${dest}`,
      },
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (data.session) {
      navigate({ to: dest });
      return;
    }
    setVerificationPending(true);
    setResendSeconds(60);
    toast.success(`Check ${email} for your Flas verification email.`);
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <div className="w-fit rounded-md bg-white px-4 py-2 shadow-sm">
          <FlasWordmark className="h-10 w-auto" />
        </div>
        <div className="space-y-4">
          <h1 className="text-4xl font-extrabold leading-tight">
            Every WhatsApp conversation, in one shared inbox.
          </h1>
          <p className="max-w-md text-sidebar-foreground/70">
            Live WhatsApp monitoring, an AI chatbot that answers instantly, website chat, and a lead
            pipeline your team actually keeps up to date.
          </p>
        </div>
        <p className="text-xs text-sidebar-foreground/50">
          The first account created becomes the workspace admin.
        </p>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <Tabs defaultValue="signin">
            <TabsList className="w-full">
              <TabsTrigger className="flex-1" value="signin">
                Sign in
              </TabsTrigger>
              <TabsTrigger className="flex-1" value="signup">
                Create account
              </TabsTrigger>
            </TabsList>

            <TabsContent value="signin">
              {mfaFactorId ? (
                <form onSubmit={verifyMfa} className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label htmlFor="mfa">Two-factor code</Label>
                    <Input
                      id="mfa"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      autoFocus
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Enter the 6-digit code from your authenticator app.
                    </p>
                  </div>
                  <Button type="submit" className="w-full" disabled={busy || mfaCode.trim().length !== 6}>
                    Verify and sign in
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={() => {
                      void supabase.auth.signOut();
                      setMfaFactorId(null);
                      setMfaCode("");
                    }}
                  >
                    Back
                  </Button>
                </form>
              ) : forgotOpen ? (
                <form onSubmit={requestPasswordReset} className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label htmlFor="reset-email">Work email</Label>
                    <Input
                      id="reset-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={busy}>
                    {busy ? "Sending reset link…" : "Send password reset link"}
                  </Button>
                  <Button type="button" variant="ghost" className="w-full" onClick={() => setForgotOpen(false)}>
                    Back to sign in
                  </Button>
                </form>
              ) : (
                <form onSubmit={signIn} className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Work email</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? "Signing in…" : "Sign in"}
                </Button>
                <Button type="button" variant="link" className="h-auto w-full p-0" onClick={() => setForgotOpen(true)}>
                  Forgot your password?
                </Button>
                </form>
              )}
            </TabsContent>

            <TabsContent value="signup">
              {verificationPending ? (
                <div className="space-y-4 pt-5 text-center">
                  <div>
                    <h2 className="font-semibold">Check your email</h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                      We sent a verification link to <span className="font-medium text-foreground">{email}</span>.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={busy || resendSeconds > 0 || resendAttempts.current >= 5}
                    onClick={resendVerification}
                  >
                    {resendAttempts.current >= 5
                      ? "Resend limit reached"
                      : resendSeconds > 0
                        ? `Resend available in ${resendSeconds}s`
                        : "Resend verification email"}
                  </Button>
                  <Button type="button" variant="ghost" className="w-full" onClick={() => setVerificationPending(false)}>
                    Use a different email
                  </Button>
                </div>
              ) : (
                <form onSubmit={signUp} className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Full name</Label>
                  <Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email2">Work email</Label>
                  <Input
                    id="email2"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password2">Password</Label>
                  <Input
                    id="password2"
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? "Creating account…" : "Create account"}
                </Button>
                </form>
              )}
            </TabsContent>
          </Tabs>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            By continuing you agree to our{" "}
            <Link to="/terms" className="underline">
              Terms
            </Link>{" "}
            and{" "}
            <Link to="/privacy" className="underline">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </div>
    </main>
  );
}
