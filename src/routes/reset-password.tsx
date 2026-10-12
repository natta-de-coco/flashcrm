import { FlashLogoBadge } from "@/components/FlashLogoBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/hooks/useI18n";

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
  const { t } = useI18n();
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
      toast.error(t("resetPassword.useAtLeast8Characters"));
      return;
    }
    if (password !== confirmPassword) {
      toast.error(t("resetPassword.thePasswordsDoNotMatch"));
      return;
    }

    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success(t("resetPassword.passwordUpdatedYouCanNow"));
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <section className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <FlashLogoBadge className="size-12" />
          <div>
            <h1 className="text-2xl font-bold">{t("resetPassword.setANewPassword")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("resetPassword.chooseAStrongPasswordFor")}
            </p>
          </div>
        </div>

        {checking ? (
          <p className="text-center text-sm text-muted-foreground">
            {t("resetPassword.checkingYourRecoveryLink")}
          </p>
        ) : recoveryReady ? (
          <form onSubmit={updatePassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">{t("resetPassword.newPassword")}</Label>
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
              <Label htmlFor="confirm-password">{t("resetPassword.confirmNewPassword")}</Label>
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
              {busy ? t("resetPassword.updatingPassword") : t("resetPassword.updatePassword")}
            </Button>
          </form>
        ) : (
          <div className="space-y-4 text-center">
            <p className="text-sm text-destructive">
              {t("resetPassword.thisRecoveryLinkIsInvalid")}
            </p>
            <Button type="button" className="w-full" onClick={() => navigate({ to: "/auth" })}>
              {t("resetPassword.returnToSignIn")}
            </Button>
          </div>
        )}
      </section>
    </main>
  );
}
