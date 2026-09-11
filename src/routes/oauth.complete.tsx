/*
 * Where the provider's callback sends the browser once it has finished.
 *
 * This page exists so that finishing a sign-in tells the tab that started it,
 * instead of leaving a person to work out that they should close a window and
 * go back. It is public and on Flas's own origin — the popup has to be able to
 * reach it while signed out, and only a same-origin page can post on the
 * BroadcastChannel the waiting tab listens to.
 *
 * Three things happen here, in order:
 *
 *   1. Announce. A ping goes out on the channel and a localStorage key is
 *      written for browsers without one. The payload is an attempt id and a
 *      word — never a token, and never treated as proof of anything: the
 *      waiting tab answers it by asking the server.
 *   2. Close. The popup closes itself.
 *   3. Fall back. If the window is still here a moment later it was never a
 *      popup — the browser blocked one, or the provider replaced the whole tab
 *      — so it navigates to the Connection Center carrying the outcome, and
 *      the result is shown in place.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  OAUTH_RETURN_CHANNEL,
  OAUTH_RETURN_STORAGE_KEY,
  legacyOutcomeSearch,
  makeReturnPing,
  readCompleteParams,
} from "@/lib/oauth-return";

export const Route = createFileRoute("/oauth/complete")({
  head: () => ({
    meta: [{ title: "Finishing sign-in — Flas CRM" }, { name: "robots", content: "noindex" }],
  }),
  component: OAuthCompletePage,
});

/** Long enough for window.close() to take effect, short enough to feel instant. */
const FALLBACK_DELAY_MS = 500;

function OAuthCompletePage() {
  const [stillOpen, setStillOpen] = useState(false);

  useEffect(() => {
    const params = readCompleteParams(new URLSearchParams(window.location.search));
    const ping = makeReturnPing(params.attemptId ?? null, Date.now());

    // 1. Announce, twice, because neither channel is universally available:
    // BroadcastChannel is missing on older Safari, and a storage event does
    // not fire in the tab that wrote it.
    try {
      const channel = new BroadcastChannel(OAUTH_RETURN_CHANNEL);
      channel.postMessage(ping);
      channel.close();
    } catch {
      /* no BroadcastChannel here; the storage fallback below still fires */
    }
    try {
      window.localStorage.setItem(OAUTH_RETURN_STORAGE_KEY, JSON.stringify(ping));
      // Removed straight away: the event has already fired, and leaving a
      // stale "something completed" marker behind would be read by the next
      // page load as news.
      window.localStorage.removeItem(OAUTH_RETURN_STORAGE_KEY);
    } catch {
      /* private mode, or storage disabled */
    }

    // 2. Close. Only works for a window a script opened, which is exactly the
    // case this page is for.
    window.close();

    // 3. Still here? Then this was never a popup.
    const timer = window.setTimeout(() => {
      if (window.closed) return;
      setStillOpen(true);
      const search = new URLSearchParams(legacyOutcomeSearch(params)).toString();
      // A plain location replace rather than a router navigation: the
      // Connection Center declares no search schema of its own, and this leaves
      // no dead popup page in the history for Back to land on.
      window.location.replace(search ? `/connect?${search}` : "/connect");
    }, FALLBACK_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-sm space-y-2 text-center">
        <h1 className="text-lg font-semibold">Finishing your connection…</h1>
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {stillOpen
            ? "Taking you back to Flas."
            : "You can close this window — Flas has the result already."}
        </p>
        <noscript>
          <p className="text-sm text-muted-foreground">
            Close this window and return to Flas to see the result.
          </p>
        </noscript>
      </div>
    </main>
  );
}
