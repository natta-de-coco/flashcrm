import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ImagePlus, Save } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTenant } from "@/hooks/useTenant";
import { supabase } from "@/integrations/supabase/client";
import { saveBillingProfile } from "@/lib/billing.functions";
import { useI18n } from "@/hooks/useI18n";

/** A remote logo is used by the existing secure invoice PDF renderer. */
export function InvoiceBrandingCard() {
  const { t } = useI18n();
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const saveBillingProfileFn = useServerFn(saveBillingProfile);
  const [logoUrl, setLogoUrl] = useState("");
  const settings = useQuery({
    queryKey: ["invoice-branding", tenant?.id],
    enabled: !!tenant?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("billing_settings")
        .select("logo_url")
        .eq("tenant_id", tenant!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  useEffect(() => setLogoUrl(settings.data?.logo_url ?? ""), [settings.data?.logo_url]);
  const save = useMutation({
    mutationFn: async () => {
      const value = logoUrl.trim();
      if (value && !/^https:\/\//i.test(value)) throw new Error("Use a secure https:// logo URL.");
      await saveBillingProfileFn({ data: { logo_url: value || null } });
    },
    onSuccess: () => {
      toast.success(t("invoiceBrandingCard.invoiceLogoSaved"));
      void queryClient.invalidateQueries({ queryKey: ["invoice-branding", tenant?.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  if (!tenant) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ImagePlus className="size-5" /> {t("invoiceBrandingCard.invoiceBranding")}
        </CardTitle>
        <CardDescription>{t("invoiceBrandingCard.yourLogoAppearsOnNewly")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="invoice-logo">{t("invoiceBrandingCard.secureLogoImageUrl")}</Label>
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
        <p className="text-xs text-muted-foreground">{t("invoiceBrandingCard.useAPublicPngJpg")}</p>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          <Save className="size-4" />
          {save.isPending
            ? t("invoiceBrandingCard.saving")
            : t("invoiceBrandingCard.saveInvoiceLogo")}
        </Button>
      </CardContent>
    </Card>
  );
}
