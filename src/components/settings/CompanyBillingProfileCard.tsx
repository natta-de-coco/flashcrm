import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { getBillingProfile, saveBillingProfile } from "@/lib/billing.functions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Building2, Check, FileSpreadsheet, Loader2, Receipt } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export function CompanyBillingProfileCard() {
  const qc = useQueryClient();
  const fetchProfile = useServerFn(getBillingProfile);
  const saveProfile = useServerFn(saveBillingProfile);

  const query = useQuery({
    queryKey: ["company-billing-profile"],
    queryFn: () => fetchProfile(),
  });

  const [legalName, setLegalName] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [trn, setTrn] = useState("");
  const [regNo, setRegNo] = useState("");
  const [taxLabel, setTaxLabel] = useState("VAT");
  const [taxRate, setTaxRate] = useState("5");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [paymentUrl, setPaymentUrl] = useState("");

  useEffect(() => {
    if (!query.data) return;
    const d = query.data as Record<string, unknown>;
    setLegalName(String(d["legal_name"] ?? ""));
    setTradeName(String(d["trade_name"] ?? ""));
    setTrn(String(d["tax_registration_number"] ?? d["vat_number"] ?? ""));
    setRegNo(String(d["registration_number"] ?? ""));
    setTaxLabel(String(d["tax_label"] ?? "VAT"));
    setTaxRate(String(d["default_tax_rate"] ?? 5));
    setAddress(String(d["address"] ?? ""));
    setPhone(String(d["phone"] ?? ""));
    setEmail(String(d["email"] ?? ""));
    setWebsite(String(d["website"] ?? ""));
    setPaymentTerms(String(d["default_payment_terms"] ?? ""));
    setPaymentUrl(String(d["online_payment_url"] ?? ""));
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: async () => {
      return saveProfile({
        data: {
          legal_name: legalName.trim() || null,
          trade_name: tradeName.trim() || null,
          tax_registration_number: trn.trim() || null,
          vat_number: trn.trim() || null,
          registration_number: regNo.trim() || null,
          tax_label: taxLabel.trim() || "VAT",
          default_tax_rate: Number(taxRate) >= 0 ? Number(taxRate) : 0,
          address: address.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
          website: website.trim() || null,
          default_payment_terms: paymentTerms.trim() || null,
          online_payment_url: paymentUrl.trim() || null,
        },
      });
    },
    onSuccess: () => {
      toast.success("Company tax and invoicing details updated.");
      void qc.invalidateQueries({ queryKey: ["company-billing-profile"] });
      void qc.invalidateQueries({ queryKey: ["sales-workspace"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (query.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Receipt className="size-4 text-primary" /> Company Tax, TRN &amp; Invoicing Profile
        </CardTitle>
        <CardDescription>
          Your company legal details and Tax Registration Number (TRN). These appear on your official
          quotation and tax invoice PDFs, ZATCA QR codes and WhatsApp payment links.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="trade-name">Company Trade / Display Name</Label>
            <Input
              id="trade-name"
              placeholder="e.g. Acme Trading LLC"
              value={tradeName}
              onChange={(e) => setTradeName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="legal-name">Registered Legal Name</Label>
            <Input
              id="legal-name"
              placeholder="e.g. Acme Group International LLC"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="trn-number" className="font-semibold text-primary">
              Tax Registration Number (TRN / VAT)
            </Label>
            <Input
              id="trn-number"
              placeholder="e.g. 100234567800003"
              value={trn}
              onChange={(e) => setTrn(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tax-label">Tax Label on Invoices</Label>
            <Input
              id="tax-label"
              placeholder="VAT, TRN, or Tax ID"
              value={taxLabel}
              onChange={(e) => setTaxLabel(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tax-rate">Default Tax Rate (%)</Label>
            <Input
              id="tax-rate"
              type="number"
              step="0.1"
              min="0"
              max="100"
              placeholder="5"
              value={taxRate}
              onChange={(e) => setTaxRate(e.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="reg-no">Commercial License / Reg. No.</Label>
            <Input
              id="reg-no"
              placeholder="e.g. CN-1029384"
              value={regNo}
              onChange={(e) => setRegNo(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Official Phone</Label>
            <Input
              id="phone"
              placeholder="+971 4 XXX XXXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="email">Official Billing Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="billing@yourcompany.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="website">Website</Label>
            <Input
              id="website"
              placeholder="https://yourcompany.com"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="address">Registered Business Address</Label>
          <Textarea
            id="address"
            rows={2}
            placeholder="Office 402, Business Tower, Downtown, Dubai, UAE"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="payment-terms">Default Payment Terms</Label>
            <Input
              id="payment-terms"
              placeholder="e.g. Net 30 days / 50% advance"
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="payment-url">Online Payment Gateway URL</Label>
            <Input
              id="payment-url"
              placeholder="https://buy.stripe.com/... or custom payment portal"
              value={paymentUrl}
              onChange={(e) => setPaymentUrl(e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="gap-2"
          >
            {mutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            Save Tax &amp; Invoicing Profile
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
