import { supabase } from "@/integrations/supabase/client";
import { forgetDraftsExcept } from "@/lib/inbox-draft-keeper";
import type { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type AuthState = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  user: null,
  session: null,
  loading: true,
  isAdmin: false,
  isSuperAdmin: false,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const signedInAs = useRef<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      // Drafts kept for the two-factor code prompt belong to the person who
      // typed them: nobody else, and nobody signed out, may find them later.
      // Neither may what the previous person's screens had loaded (every query
      // is cached without a per-person key), however they stopped being signed
      // in: sign-out, an expired session, or another tab signing in as someone
      // else while this one waited at the code prompt.
      const nowSignedInAs = next?.user?.id ?? null;
      forgetDraftsExcept(nowSignedInAs);
      if (signedInAs.current !== null && signedInAs.current !== nowSignedInAs) queryClient.clear();
      signedInAs.current = nowSignedInAs;
      setSession(next);
      setLoading(false);
    });
    supabase.auth.getSession().then(({ data }) => {
      signedInAs.current ??= data.session?.user?.id ?? null;
      setSession(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, [queryClient]);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) {
      setIsAdmin(false);
      setIsSuperAdmin(false);
      return;
    }
    let active = true;
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle()
      .then(({ data }) => {
        if (active) setIsAdmin(Boolean(data));
      });
    // Platform manager flag from the multi-tenant staff role.
    supabase
      .from("profiles")
      .select("staff_role")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setIsSuperAdmin(data?.staff_role === "super_admin");
      });
    return () => {
      active = false;
    };
  }, [session?.user?.id]);

  return (
    <AuthContext.Provider
      value={{
        user: session?.user ?? null,
        session,
        loading,
        isAdmin,
        isSuperAdmin,
        signOut: async () => {
          await supabase.auth.signOut();
          // Every cached query (contacts, messages, invoices...) is keyed
          // without a per-user namespace, so it survived sign-out and the
          // next person on a shared computer could see the previous user's
          // data until each query happened to refetch. Clearing on sign-out
          // closes that gap.
          queryClient.clear();
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
