import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Save } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTenant } from "@/hooks/useTenant";
import { supabase } from "@/integrations/supabase/client";

/** A remote logo is used by the existing secure invoice PDF renderer. */
export function InvoiceBrandingCard() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
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
      const { error } = await supabase.from("billing_settings").upsert({
        tenant_id: tenant!.id,
        logo_url: value || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Invoice logo saved");
      void queryClient.invalidateQueries({ queryKey: ["invoice-branding", tenant?.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  if (!tenant) return null;
  return <Card>
    <CardHeader><CardTitle className="flex items-center gap-2"><ImagePlus className="size-5" /> Invoice branding</CardTitle><CardDescription>Your logo appears on newly created invoices and quotations.</CardDescription></CardHeader>
    <CardContent className="space-y-3">
      <div className="space-y-1.5"><Label htmlFor="invoice-logo">Secure logo image URL</Label><Input id="invoice-logo" placeholder="https://your-site.com/logo.png" value={logoUrl} onChange={(event) => setLogoUrl(event.target.value)} /></div>
      {logoUrl && <img src={logoUrl} alt="Invoice logo preview" className="max-h-20 max-w-48 rounded border object-contain p-1" onError={(event) => { event.currentTarget.style.display = "none"; }} />}
      <p className="text-xs text-muted-foreground">Use a public PNG, JPG, or SVG hosted on your own secure website. Existing documents keep their original snapshot.</p>
      <Button onClick={() => save.mutate()} disabled={save.isPending}><Save className="size-4" />{save.isPending ? "Saving…" : "Save invoice logo"}</Button>
    </CardContent>
  </Card>;
}
