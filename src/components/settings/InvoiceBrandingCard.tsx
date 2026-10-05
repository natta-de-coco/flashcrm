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
import { uploadInvoiceLogo } from "@/lib/invoice-branding.functions";
import { Textarea } from "@/components/ui/textarea";

const COMPANY_FIELDS = [
  ["legal_name", "Company legal name"],
  ["address", "Company address"],
  ["phone", "Phone"],
  ["email", "Email"],
  ["website", "Website"],
  ["vat_number", "Tax registration number"],
  ["default_payment_terms", "Default payment terms"],
] as const;
const EMPTY_DETAILS = {
  legal_name: "",
  address: "",
  phone: "",
  email: "",
  website: "",
  vat_number: "",
  default_payment_terms: "",
  default_terms: "",
};

/** A remote logo is used by the existing secure invoice PDF renderer. */
export function InvoiceBrandingCard() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const saveBillingProfileFn = useServerFn(saveBillingProfile);
  const uploadLogo = useServerFn(uploadInvoiceLogo);
  const [logoUrl, setLogoUrl] = useState("");
  const [details, setDetails] = useState(EMPTY_DETAILS);
  const settings = useQuery({
    queryKey: ["invoice-branding", tenant?.id],
    enabled: !!tenant?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("billing_settings")
        .select(
          "logo_url, legal_name, address, phone, email, website, vat_number, default_payment_terms, default_terms",
        )
        .eq("tenant_id", tenant!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  useEffect(() => {
    setLogoUrl(settings.data?.logo_url ?? "");
    if (settings.data)
      setDetails({
        legal_name: settings.data.legal_name ?? "",
        address: settings.data.address ?? "",
        phone: settings.data.phone ?? "",
        email: settings.data.email ?? "",
        website: settings.data.website ?? "",
        vat_number: settings.data.vat_number ?? "",
        default_payment_terms: settings.data.default_payment_terms ?? "",
        default_terms: settings.data.default_terms ?? "",
      });
    else setDetails(EMPTY_DETAILS);
  }, [settings.data, tenant?.id]);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!["image/png", "image/jpeg"].includes(file.type))
        throw new Error("Choose a PNG or JPG logo.");
      if (file.size > 2 * 1024 * 1024) throw new Error("The logo must be 2 MB or smaller.");
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
      toast.success("Logo uploaded and saved for new invoices and quotations");
      // Do not refetch here: doing so would erase company details being edited.
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const save = useMutation({
    mutationFn: async () => {
      const value = logoUrl.trim();
      if (value && !/^https:\/\//i.test(value)) throw new Error("Use a secure https:// logo URL.");
      await saveBillingProfileFn({ data: { logo_url: value || null, ...details } });
    },
    onSuccess: () => {
      toast.success("Invoice branding and company details saved");
      void queryClient.invalidateQueries({ queryKey: ["invoice-branding", tenant?.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  if (!tenant) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ImagePlus className="size-5" /> Invoice branding
        </CardTitle>
        <CardDescription>
          Your logo appears on newly created invoices and quotations.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {settings.isError && (
          <p role="alert" className="text-sm text-destructive">
            Could not load invoice settings. Refresh before making changes.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {COMPANY_FIELDS.map(([key, label]) => (
            <div className="space-y-1.5" key={key}>
              <Label htmlFor={`invoice-${key}`}>{label}</Label>
              <Input
                id={`invoice-${key}`}
                value={details[key]}
                maxLength={
                  key === "address"
                    ? 500
                    : key === "default_payment_terms"
                      ? 300
                      : key === "vat_number"
                        ? 80
                        : key === "phone"
                          ? 60
                          : 200
                }
                onChange={(event) =>
                  setDetails((previous) => ({ ...previous, [key]: event.target.value }))
                }
              />
            </div>
          ))}
        </div>
        <Label htmlFor="invoice-terms">Default terms and conditions</Label>
        <Textarea
          id="invoice-terms"
          value={details.default_terms}
          maxLength={6000}
          onChange={(event) =>
            setDetails((previous) => ({ ...previous, default_terms: event.target.value }))
          }
        />
        <div className="space-y-1.5">
          <Label htmlFor="invoice-logo-file">Upload your company logo</Label>
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
            PNG or JPG, up to 2 MB. Uploaded logos are public brand images; do not upload private
            documents.
          </p>
          {upload.isPending && (
            <p role="status" className="text-sm">
              Uploading and saving your logo…
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invoice-logo">Or use a hosted logo URL</Label>
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
            alt="Invoice logo preview"
            className="max-h-20 max-w-48 rounded border object-contain p-1"
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
        )}
        <p className="text-xs text-muted-foreground">
          Use a public PNG or JPG hosted on your own secure website. Existing documents keep their
          original snapshot.
        </p>
        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending || upload.isPending || settings.isLoading || settings.isError}
        >
          <Save className="size-4" />
          {save.isPending ? "Saving…" : "Save invoice branding"}
        </Button>
      </CardContent>
    </Card>
  );
}
