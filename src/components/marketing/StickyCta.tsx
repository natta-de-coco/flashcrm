import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { ArrowRight, X } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * A conversion bar that appears once the reader has passed the hero.
 *
 * The hero's call to action scrolls away after one screen, and on a long
 * marketing page that leaves the rest of it with no way to act without
 * scrolling back. This restores one, without an interstitial or a timed popup.
 *
 * It is dismissible and stays dismissed for the session -- a bar that returns
 * after being closed is worse than no bar. It is also hidden on small screens,
 * where a fixed bottom bar competes with the chat widget for the same corner.
 */
export function StickyCta() {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem("flas.cta.dismissed") === "1") {
        setDismissed(true);
        return;
      }
    } catch {
      // Private mode or blocked storage -- showing the bar is the safe default.
    }

    // Passive listener: this runs on every scroll frame and must never be the
    // reason the page stutters.
    const onScroll = () => setVisible(window.scrollY > window.innerHeight * 1.2);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (dismissed || !visible) return null;

  return (
    <div className="flas-slide-up fixed inset-x-0 bottom-0 z-30 hidden justify-center px-4 pb-4 md:flex">
      <div className="flex max-w-3xl items-center gap-4 rounded-2xl border border-white/40 bg-card/85 px-5 py-3 shadow-2xl backdrop-blur-xl dark:border-white/10">
        <p className="text-sm">
          <span className="font-semibold">One month free</span>
          <span className="text-muted-foreground">
            {" "}
            · then $20/month for six months, instead of $30
          </span>
        </p>
        <Button asChild size="sm" className="shrink-0">
          <Link to="/auth">
            Start free <ArrowRight className="size-3.5" />
          </Link>
        </Button>
        <button
          type="button"
          aria-label="Dismiss this offer"
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => {
            setDismissed(true);
            try {
              sessionStorage.setItem("flas.cta.dismissed", "1");
            } catch {
              // Nothing to do -- it simply reappears next session.
            }
          }}
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
