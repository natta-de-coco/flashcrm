import { useMemo } from "react";
import { useTenant } from "@/hooks/useTenant";
import { navAccessFor, type NavAccess } from "@/lib/nav-access";

/**
 * What the signed-in person is offered -- the one place the role is read for the
 * sidebar, the phone drawer and bottom bar, search and "+ Create". Surfaces take
 * a list from here and never name a role themselves (see lib/nav-access.ts).
 *
 * While the profile is loading the role is null, which the permission rules treat
 * as "Home only": nothing privileged shows for a moment and then disappears,
 * because nothing privileged shows until the role is known.
 */
export function useNavAccess(): NavAccess & { loading: boolean } {
  const { staffRole, loading } = useTenant();
  const role = loading ? null : staffRole;
  const access = useMemo(() => navAccessFor(role), [role]);
  return { ...access, loading };
}
