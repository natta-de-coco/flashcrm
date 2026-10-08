import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";

export function ProfileBanner() {
  const { session } = useAuth();
  const { tenant } = useTenant();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);

  const { data: missingFields } = useQuery({
    queryKey: ["missing_profile_data", session?.user?.id, tenant?.id],
    enabled: !!session && !!tenant,
    queryFn: async () => {
      // @ts-ignore - DB types might not include newer fields yet
      const { data } = await supabase
        .from("business_profiles")
        .select("mobile_phone, tax_registration_number")
        .eq("tenant_id", tenant!.id)
        .maybeSingle();
      if (!data) return true;
      // @ts-ignore
      return !data.mobile_phone || !data.tax_registration_number;
    },
  });

  if (!missingFields || dismissed) return null;

  return (
    <div className="relative mx-4 mt-4 sm:mx-6 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 pr-8 text-sm text-amber-700 dark:text-amber-300">
      <strong>Complete your business profile</strong> — add your phone number and tax registration so your invoices are legally compliant.
      <Button variant="link" size="sm" onClick={() => navigate({ to: '/advisor' })}>Update now</Button>
      <button 
        type="button" 
        onClick={() => setDismissed(true)}
        className="absolute right-2 top-2 rounded-md p-1 opacity-70 hover:opacity-100"
        aria-label="Dismiss banner"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
