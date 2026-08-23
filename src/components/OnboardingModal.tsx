import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Building2, User } from "lucide-react";
import { toast } from "sonner";

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

/** Blocking 2-step onboarding for brand-new accounts: company + your name. */
export function OnboardingModal() {
  const { needsOnboarding, loading, refresh } = useTenant();
  const runOnboarding = useServerFn(completeOnboarding);
  const [companyName, setCompanyName] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);

  if (loading || !needsOnboarding) return null;

  const submit = async () => {
    if (companyName.trim().length < 2 || fullName.trim().length < 2) {
      toast.error("Please fill in both fields");
      return;
    }
    setBusy(true);
    try {
      await runOnboarding({ data: { companyName: companyName.trim(), fullName: fullName.trim() } });
      toast.success(`Welcome to Flash, ${fullName.trim()}! Your 1-month free trial has started.`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not finish setup");
      setBusy(false);
    }
  };

  return (
    <Dialog open>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader className="items-center text-center">
          <FlashLogoBadge className="mb-2 size-12" />
          <DialogTitle>Set up your company</DialogTitle>
          <DialogDescription>
            One quick step and your Flash workspace is ready — every account starts with a free
            month.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="ob-company" className="flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5" /> Company name
            </Label>
            <Input
              id="ob-company"
              placeholder="Acme Trading Co."
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ob-name" className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" /> Your full name
            </Label>
            <Input
              id="ob-name"
              placeholder="Jane Cooper"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>
          <Button className="w-full" onClick={submit} disabled={busy}>
            {busy ? "Creating your workspace…" : "Start my free month"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            You'll be the company admin. You can invite your team later from Team &amp; Staff.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
