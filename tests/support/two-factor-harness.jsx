// The browser half of the two-factor suite: the real sign-in page, the real
// signed-in layout and the real auth provider, mounted behind a router small
// enough to read.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { AuthProvider } from "@/hooks/useAuth";
import { I18nProvider } from "@/hooks/useI18n";
import { Route as ShellRoute } from "@/routes/_authenticated/route";
import { Route as AuthRoute } from "@/routes/auth";
import { Route as ResetRoute } from "@/routes/reset-password";
import { RouterContext } from "./two-factor-router-double.jsx";
import { watched } from "./two-factor-wire.mjs";

export { supabase } from "@/integrations/supabase/client";
export { translate } from "@/lib/i18n";
export { startInstance } from "@/start";
export { serverAnswer, serverFunction, watched } from "./two-factor-wire.mjs";

// A page that keeps redirecting must fail the test, not hang it.
const TOO_MANY_MOVES = 12;

function parse(address) {
  const url = new URL(address, "https://app.test");
  const redirect = url.searchParams.get("redirect");
  return { pathname: url.pathname, search: redirect === null ? {} : { redirect } };
}

function addressOf({ to, search }) {
  const redirect = search?.redirect;
  return redirect ? `${to}?redirect=${encodeURIComponent(redirect)}` : to;
}

/** The page an address shows: /auth is sign-in, /reset-password is the reset page, anything else is signed-in. */
function pageAt(pathname) {
  if (pathname === "/auth") return AuthRoute.options.component;
  if (pathname === "/reset-password") return ResetRoute.options.component;
  return ShellRoute.options.component;
}

/** The app, as far as sign-in is concerned. */
export function App({ startAt, language = "en" }) {
  const [location, setLocation] = useState(() => parse(startAt));
  const queryClient = useMemo(() => new QueryClient(), []);
  const navigate = useCallback((target) => {
    const address = addressOf(target);
    watched.navigations.push(address);
    if (watched.navigations.length > TOO_MANY_MOVES) return;
    setLocation(parse(address));
  }, []);
  const router = useMemo(() => ({ ...location, navigate }), [location, navigate]);
  const Page = pageAt(location.pathname);
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterContext.Provider value={router}>
          <I18nProvider language={language}>
            <div data-address={location.pathname}>
              <Page />
            </div>
          </I18nProvider>
        </RouterContext.Provider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
