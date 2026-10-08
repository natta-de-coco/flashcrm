import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Building2, Globe2, Phone, Receipt, User } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { completeOnboarding } from "@/lib/onboarding.functions";
import { FlashLogoBadge } from "@/components/FlashLogoBadge";
import { COUNTRIES, LANGUAGES } from "@/lib/locale";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const BLOCKED_NAMES = [
  "test", "testing", "admin", "administrator", "fake", "user", "company",
  "my company", "mycompany", "abc", "asdf", "qwerty", "none", "n/a", "na",
  "sample", "demo", "null", "undefined", "xyz", "owner", "customer"
];

function isDisallowedName(val: string): boolean {
  const norm = val.toLowerCase().replace(/[^a-z0-9]/g, "");
  return BLOCKED_NAMES.some((b) => norm === b || norm.startsWith("testcompany") || norm.startsWith("fakecompany"));
}

export function OnboardingModal() {
  const { needsOnboarding, loading, refresh } = useTenant();
  const { user } = useAuth();
  const runOnboarding = useServerFn(completeOnboarding);

  const [companyName, setCompanyName] = useState("");
  const [fullName, setFullName] = useState("");
  const [country, setCountry] = useState("AE");
  const [language, setLanguage] = useState("en");
  const [mobilePhone, setMobilePhone] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [landlinePhone, setLandlinePhone] = useState("");
  const [taxRegistrationNumber, setTaxRegistrationNumber] = useState("");
  const [busy, setBusy] = useState(false);

  // Whatever sign-up already knows about this person.
  const knownName =
    (user?.user_metadata?.["full_name"] as string | undefined)?.trim() ||
    (user?.user_metadata?.["name"] as string | undefined)?.trim() ||
    "";
  useEffect(() => {
    if (knownName) setFullName((current) => current || knownName);
  }, [knownName]);

  if (loading || !needsOnboarding) return null;

  const copyMobileToWhatsApp = () => {
    if (mobilePhone.trim()) {
      setWhatsappNumber(mobilePhone.trim());
      toast.success("Copied mobile to WhatsApp number");
    }
  };

  const submit = async () => {
    const trimmedCompany = companyName.trim();
    const trimmedFull = fullName.trim();
    const trimmedMobile = mobilePhone.trim();

    if (trimmedCompany.length < 3) {
      toast.error("Please enter your real company name (at least 3 characters)");
      return;
    }
    if (isDisallowedName(trimmedCompany)) {
      toast.error("Please enter a valid, real business name (generic or test names are not allowed)");
      return;
    }

    if (trimmedFull.length < 3) {
      toast.error("Please enter your real full name (at least 3 characters)");
      return;
    }
    if (isDisallowedName(trimmedFull)) {
      toast.error("Please enter your real full name");
      return;
    }

    if (trimmedMobile) {
      const digits = trimmedMobile.replace(/[^\d+]/g, "");
      if (!/^\+?[1-9]\d{6,15}$/.test(digits)) {
        toast.error("Mobile phone must be in valid international format (e.g. +971 50 123 4567)");
        return;
      }
    }

    setBusy(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      let session = sessionData.session;
      if (!session?.access_token) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        session = refreshed.session;
      }
      if (!session?.access_token) {
        toast.error("Your session expired — please sign in again.");
        setBusy(false);
        window.location.href = "/auth";
        return;
      }

      await runOnboarding({
        data: {
          companyName: trimmedCompany,
          fullName: trimmedFull,
          country,
          language,
          mobilePhone: trimmedMobile || undefined,
          whatsappNumber: whatsappNumber.trim() || undefined,
          landlinePhone: landlinePhone.trim() || undefined,
          taxRegistrationNumber: taxRegistrationNumber.trim() || undefined,
        },
      });

      toast.success(`Welcome to Flas, ${trimmedFull}! Your 1-month free trial has started.`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not finish setup");
      setBusy(false);
    }
  };

  return (
    <Dialog open>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader className="items-center text-center">
          <FlashLogoBadge className="mb-2 size-12" />
          <DialogTitle>Set up your company workspace</DialogTitle>
          <DialogDescription>
            {knownName
              ? `Welcome, ${knownName.split(" ")[0]}. Please provide your real business details so invoices, messaging and currency are set up correctly.`
              : "Please provide your real business details so invoices, messaging and currency are set up correctly."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Company & Owner */}
          <div className="space-y-3 rounded-lg border p-3 bg-muted/20">
            <div className="space-y-1.5">
              <Label htmlFor="ob-company" className="flex items-center gap-1.5 text-xs font-semibold">
                <Building2 className="h-3.5 w-3.5 text-primary" /> Company name *
              </Label>
              <Input
                id="ob-company"
                placeholder="e.g. Al Noor Logistics LLC"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ob-name" className="flex items-center gap-1.5 text-xs font-semibold">
                <User className="h-3.5 w-3.5 text-primary" /> Business owner's full name *
              </Label>
              <Input
                id="ob-name"
                placeholder="e.g. Tariq Mansoor"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
          </div>

          {/* Country & Language */}
          <div className="space-y-3 rounded-lg border p-3 bg-muted/20">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Globe2 className="h-3.5 w-3.5 text-primary" /> Region &amp; Interface Language
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="ob-country" className="text-xs">Country</Label>
                <Select value={country} onValueChange={setCountry}>
                  <SelectTrigger id="ob-country">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    {COUNTRIES.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.name} ({c.currency})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="ob-lang" className="text-xs">Language</Label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger id="ob-lang">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.code} value={l.code}>
                        {l.native} ({l.label}) {l.rtl ? "• RTL" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Contact Details */}
          <div className="space-y-3 rounded-lg border p-3 bg-muted/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Phone className="h-3.5 w-3.5 text-primary" /> Official Contact Numbers
              </div>
              {mobilePhone.trim() && (
                <button
                  type="button"
                  onClick={copyMobileToWhatsApp}
                  className="text-[11px] text-primary hover:underline"
                >
                  WhatsApp = Mobile
                </button>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="ob-mobile" className="text-xs">Mobile phone (Owner)</Label>
                <Input
                  id="ob-mobile"
                  placeholder="+971 50 123 4567"
                  value={mobilePhone}
                  onChange={(e) => setMobilePhone(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="ob-wa" className="text-xs">WhatsApp number</Label>
                <Input
                  id="ob-wa"
                  placeholder="+971 50 123 4567"
                  value={whatsappNumber}
                  onChange={(e) => setWhatsappNumber(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="ob-landline" className="text-xs">Office landline (optional)</Label>
              <Input
                id="ob-landline"
                placeholder="+971 4 123 4567"
                value={landlinePhone}
                onChange={(e) => setLandlinePhone(e.target.value)}
              />
            </div>
          </div>

          {/* Tax Registration Number */}
          <div className="space-y-2 rounded-lg border p-3 bg-muted/20">
            <Label htmlFor="ob-tax" className="flex items-center gap-1.5 text-xs font-semibold">
              <Receipt className="h-3.5 w-3.5 text-primary" /> VAT / Tax Registration Number (TRN)
            </Label>
            <Input
              id="ob-tax"
              placeholder="e.g. 100123456700003"
              value={taxRegistrationNumber}
              onChange={(e) => setTaxRegistrationNumber(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              This will automatically be printed on all your quotations and invoices. You can also add or update this anytime in Settings / Business Profile.
            </p>
          </div>

          <Button className="w-full" onClick={submit} disabled={busy}>
            {busy ? "Setting up your workspace…" : "Complete Setup & Start Free Month"}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            All details can be updated anytime from Settings &amp; Business Profile.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
