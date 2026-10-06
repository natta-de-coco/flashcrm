import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Building2, CreditCard, FileCheck2, ImagePlus, Landmark, Save } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useTenant } from "@/hooks/useTenant";
import { supabase } from "@/integrations/supabase/client";
import { saveBillingProfile } from "@/lib/billing.functions";
import { uploadInvoiceLogo } from "@/lib/invoice-branding.functions";
import { useI18n } from "@/hooks/useI18n";

const EMPTY_DETAILS = {
  legal_name: "",
  trade_name: "",
  registration_number: "",
  vat_number: "",
  address: "",
  phone: "",
  email: "",
  website: "",
  default_currency: "AED",
  tax_label: "VAT",
  default_tax_rate: 5,
  tax_inclusive: false,
  default_payment_terms: "",
  default_notes: "",
  default_terms: "",
  online_payment_url: "",
  signatory_name: "",
  signatory_position: "",
  show_qr_verification: true,
};

const EMPTY_BANK = {
  bank_name: "",
  account_name: "",
  account_number: "",
  iban: "",
  swift: "",
};

export function InvoiceBrandingCard() {
  const { t } = useI18n();
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const saveBillingProfileFn = useServerFn(saveBillingProfile);
  const uploadLogo = useServerFn(uploadInvoiceLogo);

  const [logoUrl, setLogoUrl] = useState("");
  const [details, setDetails] = useState(EMPTY_DETAILS);
  const [bank, setBank] = useState(EMPTY_BANK);

  const settings = useQuery({
    queryKey: ["invoice-branding", tenant?.id],
    enabled: !!tenant?.id,
    queryFn: async () => {
      const [billingRes, bankRes] = await Promise.all([
        supabase
          .from("billing_settings")
          .select("*")
          .eq("tenant_id", tenant!.id)
          .maybeSingle(),
        supabase
          .from("bank_accounts")
          .select("bank_name, account_name, account_number, iban, swift, is_default")
          .eq("tenant_id", tenant!.id)
          .order("is_default", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (billingRes.error) throw billingRes.error;
      return { billing: billingRes.data, bank: bankRes.data };
    },
  });

  useEffect(() => {
    const data = settings.data?.billing;
    const bankData = settings.data?.bank;

    setLogoUrl(data?.logo_url ?? "");
    if (data) {
      setDetails({
        legal_name: data.legal_name ?? "",
        trade_name: data.trade_name ?? "",
        registration_number: data.registration_number ?? "",
        vat_number: data.vat_number ?? "",
        address: data.address ?? "",
        phone: data.phone ?? "",
        email: data.email ?? "",
        website: data.website ?? "",
        default_currency: data.default_currency ?? "AED",
        tax_label: data.tax_label ?? "VAT",
        default_tax_rate: Number(data.default_tax_rate ?? 5),
        tax_inclusive: Boolean(data.tax_inclusive ?? false),
        default_payment_terms: data.default_payment_terms ?? "",
        default_notes: data.default_notes ?? "",
        default_terms: data.default_terms ?? "",
        online_payment_url: data.online_payment_url ?? "",
        signatory_name: data.signatory_name ?? "",
        signatory_position: data.signatory_position ?? "",
        show_qr_verification: Boolean(data.show_qr_verification ?? true),
      });
    } else {
      setDetails(EMPTY_DETAILS);
    }

    if (bankData) {
      setBank({
        bank_name: bankData.bank_name ?? "",
        account_name: bankData.account_name ?? "",
        account_number: bankData.account_number ?? "",
        iban: bankData.iban ?? "",
        swift: bankData.swift ?? "",
      });
    } else {
      setBank(EMPTY_BANK);
    }
  }, [settings.data, tenant?.id]);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!["image/png", "image/jpeg"].includes(file.type)) {
        throw new Error("Choose a PNG or JPG logo.");
      }
      if (file.size > 2 * 1024 * 1024) {
        throw new Error("The logo must be 2 MB or smaller.");
      }
      const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read the image."));
        reader.readAsDataURL(file);
      });
      return uploadLogo({ data: { image } });
    },
    onSuccess: ({ logoUrl: uploaded }) => {
      setLogoUrl(uploaded);
      toast.success(t("invoiceBrandingCard.logoUploadedAndSavedFor"));
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const save = useMutation({
    mutationFn: async () => {
      const value = logoUrl.trim();
      if (value && !/^https:\/\//i.test(value)) {
        throw new Error("Use a secure https:// logo URL.");
      }
      await saveBillingProfileFn({
        data: {
          logo_url: value || null,
          legal_name: details.legal_name || null,
          trade_name: details.trade_name || null,
          registration_number: details.registration_number || null,
          vat_number: details.vat_number || null,
          address: details.address || null,
          phone: details.phone || null,
          email: details.email || null,
          website: details.website || null,
          default_currency: details.default_currency || "AED",
          tax_label: details.tax_label || "VAT",
          default_tax_rate: Number(details.default_tax_rate || 0),
          tax_inclusive: details.tax_inclusive,
          default_payment_terms: details.default_payment_terms || null,
          default_notes: details.default_notes || null,
          default_terms: details.default_terms || null,
          online_payment_url: details.online_payment_url || null,
          signatory_name: details.signatory_name || null,
          signatory_position: details.signatory_position || null,
          show_qr_verification: details.show_qr_verification,
          bank_account: bank.bank_name.trim()
            ? {
                bank_name: bank.bank_name.trim(),
                account_name: bank.account_name.trim() || null,
                account_number: bank.account_number.trim() || null,
                iban: bank.iban.trim() || null,
                swift: bank.swift.trim() || null,
              }
            : null,
        },
      });
    },
    onSuccess: () => {
      toast.success(t("invoiceBrandingCard.invoiceBrandingAndCompanyDetails"));
      void queryClient.invalidateQueries({ queryKey: ["invoice-branding", tenant?.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!tenant) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ImagePlus className="size-5" /> {t("invoiceBrandingCard.invoicingSetup")}
        </CardTitle>
        <CardDescription>{t("invoiceBrandingCard.invoicingSetupDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {settings.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t("invoiceBrandingCard.couldNotLoadInvoiceSettings")}
          </p>
        )}

        <Tabs defaultValue="company" className="w-full">
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
            <TabsTrigger value="company" className="flex items-center gap-1.5 text-xs sm:text-sm">
              <Building2 className="size-3.5" />
              <span>{t("invoiceBrandingCard.companyDetails")}</span>
            </TabsTrigger>
            <TabsTrigger value="defaults" className="flex items-center gap-1.5 text-xs sm:text-sm">
              <CreditCard className="size-3.5" />
              <span>{t("invoiceBrandingCard.invoicingDefaults")}</span>
            </TabsTrigger>
            <TabsTrigger value="bank" className="flex items-center gap-1.5 text-xs sm:text-sm">
              <Landmark className="size-3.5" />
              <span>{t("invoiceBrandingCard.bankDetails")}</span>
            </TabsTrigger>
            <TabsTrigger value="branding" className="flex items-center gap-1.5 text-xs sm:text-sm">
              <FileCheck2 className="size-3.5" />
              <span>{t("invoiceBrandingCard.brandingAndVerification")}</span>
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: COMPANY DETAILS */}
          <TabsContent value="company" className="space-y-3 pt-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="invoice-legal_name">
                  {t("invoiceBrandingCard.companyLegalName")}
                </Label>
                <Input
                  id="invoice-legal_name"
                  value={details.legal_name}
                  maxLength={200}
                  onChange={(e) => setDetails((prev) => ({ ...prev, legal_name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invoice-trade_name">{t("invoiceBrandingCard.tradeName")}</Label>
                <Input
                  id="invoice-trade_name"
                  value={details.trade_name}
                  maxLength={200}
                  onChange={(e) => setDetails((prev) => ({ ...prev, trade_name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invoice-registration_number">
                  {t("invoiceBrandingCard.registrationNumber")}
                </Label>
                <Input
                  id="invoice-registration_number"
                  value={details.registration_number}
                  maxLength={80}
                  onChange={(e) =>
                    setDetails((prev) => ({ ...prev, registration_number: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invoice-vat_number">
                  {t("invoiceBrandingCard.taxRegistrationNumber")}
                </Label>
                <Input
                  id="invoice-vat_number"
                  value={details.vat_number}
                  maxLength={80}
                  onChange={(e) => setDetails((prev) => ({ ...prev, vat_number: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="invoice-address">{t("invoiceBrandingCard.address")}</Label>
                <Input
                  id="invoice-address"
                  value={details.address}
                  maxLength={500}
                  onChange={(e) => setDetails((prev) => ({ ...prev, address: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invoice-phone">{t("invoiceBrandingCard.phone")}</Label>
                <Input
                  id="invoice-phone"
                  value={details.phone}
                  maxLength={60}
                  onChange={(e) => setDetails((prev) => ({ ...prev, phone: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invoice-email">{t("invoiceBrandingCard.email")}</Label>
                <Input
                  id="invoice-email"
                  type="email"
                  value={details.email}
                  maxLength={200}
                  onChange={(e) => setDetails((prev) => ({ ...prev, email: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="invoice-website">{t("invoiceBrandingCard.website")}</Label>
                <Input
                  id="invoice-website"
                  placeholder="https://example.com"
                  value={details.website}
                  maxLength={200}
                  onChange={(e) => setDetails((prev) => ({ ...prev, website: e.target.value }))}
                />
              </div>
            </div>
          </TabsContent>

          {/* TAB 2: INVOICING & TAX DEFAULTS */}
          <TabsContent value="defaults" className="space-y-3 pt-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="invoice-default_currency">
                  {t("invoiceBrandingCard.defaultCurrency")}
                </Label>
                <Input
                  id="invoice-default_currency"
                  value={details.default_currency}
                  maxLength={6}
                  placeholder="AED, USD, SAR, EUR"
                  onChange={(e) =>
                    setDetails((prev) => ({
                      ...prev,
                      default_currency: e.target.value.toUpperCase().slice(0, 6),
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invoice-tax_label">{t("invoiceBrandingCard.taxLabel")}</Label>
                <Input
                  id="invoice-tax_label"
                  value={details.tax_label}
                  maxLength={40}
                  placeholder="VAT"
                  onChange={(e) => setDetails((prev) => ({ ...prev, tax_label: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invoice-default_tax_rate">
                  {t("invoiceBrandingCard.defaultTaxRate")}
                </Label>
                <Input
                  id="invoice-default_tax_rate"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={details.default_tax_rate}
                  onChange={(e) =>
                    setDetails((prev) => ({
                      ...prev,
                      default_tax_rate: Number(e.target.value) || 0,
                    }))
                  }
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <Label htmlFor="invoice-tax_inclusive" className="cursor-pointer">
                  {t("invoiceBrandingCard.taxInclusive")}
                </Label>
                <Switch
                  id="invoice-tax_inclusive"
                  checked={details.tax_inclusive}
                  onCheckedChange={(checked) =>
                    setDetails((prev) => ({ ...prev, tax_inclusive: checked }))
                  }
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="invoice-default_payment_terms">
                  {t("invoiceBrandingCard.defaultPaymentTerms")}
                </Label>
                <Input
                  id="invoice-default_payment_terms"
                  placeholder="e.g. Net 30 days"
                  value={details.default_payment_terms}
                  maxLength={300}
                  onChange={(e) =>
                    setDetails((prev) => ({ ...prev, default_payment_terms: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="invoice-online_payment_url">
                  {t("invoiceBrandingCard.onlinePaymentUrl")}
                </Label>
                <Input
                  id="invoice-online_payment_url"
                  placeholder="https://pay.example.com"
                  value={details.online_payment_url}
                  maxLength={500}
                  onChange={(e) =>
                    setDetails((prev) => ({ ...prev, online_payment_url: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="invoice-default_notes">
                  {t("invoiceBrandingCard.defaultNotes")}
                </Label>
                <Textarea
                  id="invoice-default_notes"
                  value={details.default_notes}
                  maxLength={4000}
                  rows={2}
                  onChange={(e) =>
                    setDetails((prev) => ({ ...prev, default_notes: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="invoice-terms">
                  {t("invoiceBrandingCard.defaultTermsAndConditions")}
                </Label>
                <Textarea
                  id="invoice-terms"
                  value={details.default_terms}
                  maxLength={6000}
                  rows={3}
                  onChange={(e) =>
                    setDetails((prev) => ({ ...prev, default_terms: e.target.value }))
                  }
                />
              </div>
            </div>
          </TabsContent>

          {/* TAB 3: BANK DETAILS */}
          <TabsContent value="bank" className="space-y-3 pt-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="invoice-bank_name">{t("invoiceBrandingCard.bankName")}</Label>
                <Input
                  id="invoice-bank_name"
                  value={bank.bank_name}
                  maxLength={200}
                  placeholder="e.g. Emirates NBD, ADCB"
                  onChange={(e) => setBank((prev) => ({ ...prev, bank_name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invoice-account_name">{t("invoiceBrandingCard.accountName")}</Label>
                <Input
                  id="invoice-account_name"
                  value={bank.account_name}
                  maxLength={200}
                  placeholder="Beneficiary Account Name"
                  onChange={(e) => setBank((prev) => ({ ...prev, account_name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invoice-account_number">
                  {t("invoiceBrandingCard.accountNumber")}
                </Label>
                <Input
                  id="invoice-account_number"
                  value={bank.account_number}
                  maxLength={100}
                  onChange={(e) =>
                    setBank((prev) => ({ ...prev, account_number: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invoice-iban">{t("invoiceBrandingCard.iban")}</Label>
                <Input
                  id="invoice-iban"
                  value={bank.iban}
                  maxLength={100}
                  placeholder="AE00 0000 0000 0000 0000 000"
                  onChange={(e) => setBank((prev) => ({ ...prev, iban: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="invoice-swift">{t("invoiceBrandingCard.swift")}</Label>
                <Input
                  id="invoice-swift"
                  value={bank.swift}
                  maxLength={50}
                  placeholder="e.g. EBILAEADXXX"
                  onChange={(e) => setBank((prev) => ({ ...prev, swift: e.target.value }))}
                />
              </div>
            </div>
          </TabsContent>

          {/* TAB 4: BRANDING, SIGNATORY & QR */}
          <TabsContent value="branding" className="space-y-3 pt-3">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="invoice-logo-file">
                  {t("invoiceBrandingCard.uploadYourCompanyLogo")}
                </Label>
                <Input
                  id="invoice-logo-file"
                  type="file"
                  accept="image/png,image/jpeg"
                  disabled={upload.isPending || save.isPending || settings.isLoading || settings.isError}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) upload.mutate(file);
                    event.target.value = "";
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {t("invoiceBrandingCard.pngOrJpgUpTo")}
                </p>
                {upload.isPending && (
                  <p role="status" className="text-sm">
                    {t("invoiceBrandingCard.uploadingAndSavingYourLogo")}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="invoice-logo">{t("invoiceBrandingCard.orUseAHostedLogo")}</Label>
                <Input
                  id="invoice-logo"
                  placeholder="https://your-site.com/logo.png"
                  value={logoUrl}
                  onChange={(event) => setLogoUrl(event.target.value)}
                />
              </div>

              {logoUrl && (
                <img
                  key={logoUrl}
                  src={logoUrl}
                  alt={t("invoiceBrandingCard.invoiceLogoPreview")}
                  className="max-h-20 max-w-48 rounded border object-contain p-1"
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
                />
              )}

              <div className="grid gap-3 pt-2 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="invoice-signatory_name">
                    {t("invoiceBrandingCard.signatoryName")}
                  </Label>
                  <Input
                    id="invoice-signatory_name"
                    value={details.signatory_name}
                    maxLength={200}
                    onChange={(e) =>
                      setDetails((prev) => ({ ...prev, signatory_name: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="invoice-signatory_position">
                    {t("invoiceBrandingCard.signatoryPosition")}
                  </Label>
                  <Input
                    id="invoice-signatory_position"
                    value={details.signatory_position}
                    maxLength={200}
                    onChange={(e) =>
                      setDetails((prev) => ({ ...prev, signatory_position: e.target.value }))
                    }
                  />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <Label htmlFor="invoice-show_qr" className="cursor-pointer">
                  {t("invoiceBrandingCard.showQrVerification")}
                </Label>
                <Switch
                  id="invoice-show_qr"
                  checked={details.show_qr_verification}
                  onCheckedChange={(checked) =>
                    setDetails((prev) => ({ ...prev, show_qr_verification: checked }))
                  }
                />
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending || upload.isPending || settings.isLoading || settings.isError}
          className="mt-4"
        >
          <Save className="size-4" />
          {save.isPending
            ? t("invoiceBrandingCard.saving")
            : t("invoiceBrandingCard.saveInvoicingSetup")}
        </Button>
      </CardContent>
    </Card>
  );
}
