import { supabase } from "@/integrations/supabase/client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";

export type TenantInfo = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  subscription_status: string;
  subscription_renews_at: string | null;
  suspended: boolean;
  currency: string;
};

type TenantState = {
  tenant: TenantInfo | null;
  staffRole: string | null;
  needsOnboarding: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
};

const TenantContext = createContext<TenantState>({
  tenant: null,
  staffRole: null,
  needsOnboarding: false,
  loading: true,
  refresh: async () => {},
});

export function TenantProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [staffRole, setStaffRole] = useState<string | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user) {
      setTenant(null);
      setStaffRole(null);
      setNeedsOnboarding(false);
      setLoading(false);
      return;
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id, staff_role")
      .eq("id", user.id)
      .maybeSingle();

    setStaffRole(profile?.staff_role ?? null);
    if (!profile?.tenant_id) {
      setTenant(null);
      setNeedsOnboarding(true);
      setLoading(false);
      return;
    }
    const { data: org } = await supabase
      .from("organizations")
      .select(
        "id, name, slug, plan, subscription_status, subscription_renews_at, suspended, currency",
      )
      .eq("id", profile.tenant_id)
      .maybeSingle();
    setTenant((org as TenantInfo | null) ?? null);
    setNeedsOnboarding(!org);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return (
    <TenantContext.Provider value={{ tenant, staffRole, needsOnboarding, loading, refresh: load }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  return useContext(TenantContext);
}
