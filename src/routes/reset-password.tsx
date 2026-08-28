import { FlashLogoBadge } from "@/components/FlashLogoBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset password — Flas CRM" },
      { name: "description", content: "Choose a new password for your Flas CRM account." },
      { property: "og:title", content: "Reset password — Flas CRM" },
      { property: "og:description", content: "Securely restore access to your Flas CRM account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;

    const checkRecovery = async () => {
      const recoveryHash = window.location.hash.includes("type=recovery");
      const { data } = await supabase.auth.getSession();
      if (active) {
        setRecoveryReady(recoveryHash || Boolean(data.session));
        setChecking(false);
      }
    };

    void checkRecovery();
    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (active && event === "PASSWORD_RECOVERY") {
        setRecoveryReady(Boolean(session));
        setChecking(false);
      }
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  async function updatePassword(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 8) {
      toast.error("Use at least 8 characters for your new password.");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("The passwords do not match.");
      return;
    }

    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Password updated. You can now sign in.");
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <section className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <FlashLogoBadge className="size-12" />
          <div>
            <h1 className="text-2xl font-bold">Set a new password</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose a strong password for your Flas CRM account.
            </p>
          </div>
        </div>

        {checking ? (
          <p className="text-center text-sm text-muted-foreground">Checking your recovery link…</p>
        ) : recoveryReady ? (
          <form onSubmit={updatePassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                minLength={8}
                required
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                minLength={8}
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Updating password…" : "Update password"}
            </Button>
          </form>
        ) : (
          <div className="space-y-4 text-center">
            <p className="text-sm text-destructive">
              This recovery link is invalid or expired. Request a new one from the sign-in page.
            </p>
            <Button type="button" className="w-full" onClick={() => navigate({ to: "/auth" })}>
              Return to sign in
            </Button>
          </div>
        )}
      </section>
    </main>
  );
}