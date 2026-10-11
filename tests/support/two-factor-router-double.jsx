// Stands in for @tanstack/react-router in the two-factor screen suite: just
// enough of it for the sign-in page and the signed-in layout to decide where
// to send somebody. The harness owns "where we are" and records every move,
// so a page that bounces between two addresses is caught rather than hung on.
import { createContext, useContext } from "react";

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

/** Whatever signed-in screen the address names: the thing two-factor protects. */
export function Outlet() {
  return <div data-testid="signed-in-screen">a signed-in screen</div>;
}
