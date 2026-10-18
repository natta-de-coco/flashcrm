import { useEffect } from "react";
/** Fit chat between shell controls, including a mobile keyboard's visual viewport. */
export function useInboxViewport(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const viewport = window.visualViewport;
    const resize = () => {
      document.documentElement.dataset["inboxKeyboard"] =
        viewport && window.innerHeight - viewport.height > 120 ? "open" : "closed";
      document.documentElement.style.setProperty(
        "--inbox-viewport",
        `${Math.round(viewport?.height ?? window.innerHeight)}px`,
      );
    };
    resize();
    viewport?.addEventListener("resize", resize);
    window.addEventListener("resize", resize);
    return () => {
      viewport?.removeEventListener("resize", resize);
      window.removeEventListener("resize", resize);
      document.documentElement.style.removeProperty("--inbox-viewport");
      delete document.documentElement.dataset["inboxKeyboard"];
    };
  }, [enabled]);
}
