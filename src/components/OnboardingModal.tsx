import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Bot, Building2, User } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { completeOnboarding } from "@/lib/onboarding.functions";
import { FlashLogoBadge } from "@/components/FlashLogoBadge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/hooks/useI18n";

/**
 * The one blocking step for a brand-new account: name the company.
 *
 * It used to ask for your full name here as well -- which sign-up had already
 * collected two minutes earlier and stored on the account. Being asked the same
 * thing twice in the first two screens is the fastest way to make a product
 * feel unfinished, so the name is carried over and the field only appears when
 * sign-up genuinely did not capture one (an invited teammate, or an OAuth
 * provider that returned no name).
 */
export function OnboardingModal() {
  const { t } = useI18n();
  const { needsOnboarding, loading, refresh } = useTenant();
  const { user } = useAuth();
  const runOnboarding = useServerFn(completeOnboarding);
  const [companyName, setCompanyName] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [botGreeting, setBotGreeting] = useState("");
  const [botDetails, setBotDetails] = useState("");
  const [botEnabled, setBotEnabled] = useState(false);
  const botTouched = botGreeting.trim().length > 0 || botDetails.trim().length > 0;
  const botReady = botGreeting.trim().length > 0 && botDetails.trim().length >= 20;

  // Whatever sign-up already knows about this person.
  const knownName =
    (user?.user_metadata?.["full_name"] as string | undefined)?.trim() ||
    (user?.user_metadata?.["name"] as string | undefined)?.trim() ||
    "";
  useEffect(() => {
    if (knownName) setFullName((current) => current || knownName);
  }, [knownName]);

  if (loading || !needsOnboarding) return null;

  const submit = async () => {
    if (companyName.trim().length < 2) {
      toast.error(t("onboardingModal.pleaseEnterYourCompanyName"));
      return;
    }
    if (fullName.trim().length < 2) {
      toast.error(t("onboardingModal.pleaseEnterYourFullName"));
      return;
    }
    if (botTouched && !botReady) {
      toast.error(t("onboardingModal.chatbotDetailsShort"));
      return;
    }
    setBusy(true);
    try {
      // The server function requires a bearer token. If the local session has
      // lapsed (expired token, signed out in another tab) the call would fail
      // with "No authorization header provided" and blank the screen, so refresh
      // first and send the user back to sign-in when there is nothing to refresh.
      const { data: sessionData } = await supabase.auth.getSession();
      let session = sessionData.session;
      if (!session?.access_token) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        session = refreshed.session;
      }
      if (!session?.access_token) {
        toast.error(t("onboardingModal.yourSessionExpiredPleaseSign"));
        setBusy(false);
        window.location.href = "/auth";
        return;
      }
      await runOnboarding({ data: {
          companyName: companyName.trim(),
          fullName: fullName.trim(),
          botGreeting: botGreeting.trim(),
          botDetails: botDetails.trim(),
          botEnabled: botReady && botEnabled,
        },
      });
      toast.success(t("onboardingModal.welcomeToFlasYour1", { trim: fullName.trim() }));
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("onboardingModal.couldNotFinishSetup"));
      setBusy(false);
    }
  };

  return (
    <Dialog open>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader className="items-center text-center">
          <FlashLogoBadge className="mb-2 size-12" />
          <DialogTitle>{t("onboardingModal.nameYourCompany")}</DialogTitle>
          <DialogDescription>
            {knownName
              ? t("onboardingModal.oneQuickStepThenYour", { value: knownName.split(" ")[0] })
              : t("onboardingModal.oneQuickStepAndYour")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="ob-company" className="flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5" /> {t("onboardingModal.companyName")}
            </Label>
            <Input
              id="ob-company"
              placeholder={t("onboardingModal.acmeTradingCo")}
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && knownName && submit()}
              autoFocus
            />
          </div>
          {!knownName && (
            <div className="space-y-2">
              <Label htmlFor="ob-name" className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" /> {t("onboardingModal.yourFullName")}
              </Label>
              <Input
                id="ob-name"
                placeholder={t("onboardingModal.janeCooper")}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </div>
          )}
          <div className="space-y-3 rounded-md border p-3">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Bot className="h-3.5 w-3.5" /> {t("onboardingModal.chatbotSection")}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="ob-greeting">{t("onboardingModal.chatbotGreeting")}</Label>
              <Input
                id="ob-greeting"
                maxLength={500}
                placeholder={t("onboardingModal.chatbotGreetingPh")}
                value={botGreeting}
                onChange={(e) => setBotGreeting(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ob-details">{t("onboardingModal.chatbotDetails")}</Label>
              <Textarea
                id="ob-details"
                rows={3}
                maxLength={4000}
                placeholder={t("onboardingModal.chatbotDetailsPh")}
                value={botDetails}
                onChange={(e) => setBotDetails(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={botReady && botEnabled} disabled={!botReady} onCheckedChange={setBotEnabled} />
              {t("onboardingModal.chatbotTurnOn")}
            </label>
            <p className="text-xs text-muted-foreground">{t("onboardingModal.chatbotHint")}</p>
          </div>
          <Button className="w-full" onClick={submit} disabled={busy}>
            {busy
              ? t("onboardingModal.creatingYourWorkspace")
              : t("onboardingModal.startMyFreeMonth")}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            {t("onboardingModal.youLlBeTheCompany")}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
