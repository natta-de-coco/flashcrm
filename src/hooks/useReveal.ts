import { useEffect } from "react";

/**
 * Scroll-reveal for the public marketing pages.
 *
 * Adds `js-reveal` to <html> only once this runs, which is what actually hides
 * the elements: the CSS keeps everything visible until then. A crawler that
 * renders without executing scripts, or a browser where this chunk fails to
 * load, sees the full page rather than an empty one waiting on an animation
 * that will never fire.
 *
 * Elements opt in with `data-reveal`, and stagger with `--reveal-delay`.
 * Each element is unobserved once shown, so scrolling back up does not replay
 * the page at the reader.
 */
export function useReveal() {
  useEffect(() => {
    const root = document.documentElement;
    const targets = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (targets.length === 0) return;

    // Honour the OS preference before hiding anything at all.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof IntersectionObserver === "undefined") {
      for (const el of targets) el.dataset["shown"] = "true";
      return;
    }

    root.classList.add("js-reveal");

    // Anything already on screen at load reveals immediately, so the hero is
    // never briefly blank while the observer settles.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset["shown"] = "true";
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.05 },
    );

    for (const el of targets) observer.observe(el);

    return () => {
      observer.disconnect();
      root.classList.remove("js-reveal");
    };
  }, []);
}
