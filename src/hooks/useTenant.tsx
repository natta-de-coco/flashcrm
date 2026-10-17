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
  /** IANA zone. Dates a customer sees must be computed in it, not in UTC. */
  timezone: string | null;
  /** The company's language: the interface default for a teammate who has not picked one. */
  locale: string | null;
  paddle_customer_id?: string | null;
  paddle_subscription_id?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  billing_provider?: string | null;
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
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("tenant_id, staff_role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      // Transient error reading profile: do not treat as unonboarded
      setLoading(false);
      return;
    }

    setStaffRole(profile?.staff_role ?? null);
    if (!profile?.tenant_id) {
      setTenant(null);
      setNeedsOnboarding(true);
      setLoading(false);
      return;
    }

    let orgData: unknown = null;
    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select(
        "id, name, slug, plan, subscription_status, subscription_renews_at, suspended, currency, timezone, locale, paddle_customer_id, paddle_subscription_id, stripe_customer_id, stripe_subscription_id, billing_provider",
      )
      .eq("id", profile.tenant_id)
      .maybeSingle();

    if (orgError) {
      // Fallback if schema does not yet have newer columns
      const isMissingColumn =
        orgError.code === "42703" ||
        orgError.message?.includes("column") ||
        orgError.message?.includes("does not exist");
      if (isMissingColumn) {
        const { data: fallbackOrg } = await supabase
          .from("organizations")
          .select(
            "id, name, slug, plan, subscription_status, subscription_renews_at, suspended, currency, timezone, locale",
          )
          .eq("id", profile.tenant_id)
          .maybeSingle();
        if (fallbackOrg) {
          orgData = fallbackOrg;
        }
      }
      // If transient read failure, preserve previous state rather than kicking user to onboarding
    } else {
      orgData = org;
    }

    if (orgData) {
      setTenant(orgData as TenantInfo);
      setNeedsOnboarding(false);
    } else if (!orgError) {
      // Only when query genuinely succeeded and returned no row
      setTenant(null);
      setNeedsOnboarding(true);
    }
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
