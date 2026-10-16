// Stands in for @tanstack/react-router in the two-factor screen suite: just
// enough of it for the sign-in page and the signed-in layout to decide where
// to send somebody. The harness owns "where we are" and records every move,
// so a page that bounces between two addresses is caught rather than hung on.
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useConversationDrafts } from "@/hooks/useConversationDrafts";
import { useTenant } from "@/hooks/useTenant";
import { watched } from "./two-factor-wire.mjs";

export const RouterContext = createContext(null);

const here = () => {
  const router = useContext(RouterContext);
  if (!router) throw new Error("rendered outside the test harness");
  return router;
};

export function createFileRoute(path) {
  return (options) => ({ path, options, useSearch: () => here().search });
}

export function useNavigate() {
  return here().navigate;
}

export function useRouterState({ select }) {
  return select({ location: { pathname: here().pathname }, matches: [] });
}

export function useRouter() {
  return { invalidate: async () => {} };
}

export function Link({ to, children, activeProps: _activeProps, ...rest }) {
  return (
    <a href={to} {...rest}>
      {children}
    </a>
  );
}

/**
 * Whatever signed-in screen the address names: the thing two-factor protects.
 * It uses the inbox's own draft hook, under the same identity the inbox uses,
 * so a test can type a reply, start a send and see what survives. What it
 * holds is in watched.drafts and in the screen's data-draft attribute.
 */
export function Outlet() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const drafts = useConversationDrafts(`${user?.id}:${tenant?.id}`, "conv-1");
  watched.drafts = drafts;
  // Something a real screen loads and the app caches without a per-person key
  // (every query in this app is cached that way). Kept for good, and never
  // refetched, so whatever is in the cache when somebody signs in is what they get.
  const loaded = useQuery({
    queryKey: ["loaded-by-the-screen"],
    queryFn: async () => `loaded for ${user?.id}`,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return (
    <div
      data-testid="signed-in-screen"
      data-scope={`${user?.id}:${tenant?.id}`}
      data-draft={drafts.draft}
      data-loaded={loaded.data ?? ""}
    >
      a signed-in screen
    </div>
  );
}
