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
export { forgetDraftsExcept, keepDrafts, recallDrafts } from "@/lib/inbox-draft-keeper";
export { emptyDrafts } from "@/lib/inbox-drafts";
export { InboxSendSession } from "@/lib/inbox-send-session";
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

/** The query cache of the app that was last drawn, so a test can put data in it and see what a sign-out leaves. */
export const lastQueryClient = { current: null };

/** The app, as far as sign-in is concerned. */
export function App({ startAt, language = "en" }) {
  const [location, setLocation] = useState(() => parse(startAt));
  // gcTime 0: the default keeps every query for five minutes after its page is
  // gone, which holds a timer open and made `node --test` wait about five
  // minutes after the last test had finished.
  const queryClient = useMemo(() => {
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
    lastQueryClient.current = client;
    return client;
  }, []);
  const navigate = useCallback((target) => {
    const address = addressOf(target);
    watched.navigations.push(address);
    if (watched.navigations.length > TOO_MANY_MOVES || watched.holdNavigation) return;
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
