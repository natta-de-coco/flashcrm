// Loads the real Flas chat widget on the marketing pages, when the platform
// owner has a website set up for this domain (see homepage-widget.functions).
// Renders nothing itself: widget.js draws its own launcher.
import { getHomepageWidgetKey } from "@/lib/homepage-widget.functions";
import { useEffect } from "react";

const SCRIPT_ID = "flas-homepage-widget";

export function HomepageChatWidget() {
  useEffect(() => {
    // widget.js keeps one launcher per page; navigating between marketing
    // pages must not add a second.
    if (document.getElementById(SCRIPT_ID)) return;
    let cancelled = false;
    getHomepageWidgetKey({ data: { host: window.location.hostname } })
      .then(({ siteKey }) => {
        if (cancelled || !siteKey || document.getElementById(SCRIPT_ID)) return;
        const script = document.createElement("script");
        script.id = SCRIPT_ID;
        script.src = "/widget.js";
        script.async = true;
        script.setAttribute("data-site-key", siteKey);
        document.body.appendChild(script);
      })
      .catch(() => {
        // No widget is better than a broken page. The lookup failing means
        // visitors see the page without chat, exactly as they do today.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
