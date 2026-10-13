import { useTenant } from "@/hooks/useTenant";

/**
 * The role every menu surface asks about -- the sidebar, the phone drawer and
 * bottom bar, search and "+ Create" -- so they all start from the same answer.
 * While the profile is loading the role is null, which the permission rules
 * treat as "Home only": nothing privileged shows for a moment and then
 * disappears, because nothing privileged shows until the role is known.
 */
export function useNavAccess(): { role: string | null; loading: boolean } {
  const { staffRole, loading } = useTenant();
  return { role: loading ? null : staffRole, loading };
}
