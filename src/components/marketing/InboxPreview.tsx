import { useEffect, useRef, useState } from "react";
import { Bot, Check, CheckCheck } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";

/**
 * An animated mock of the Flas inbox, for the landing hero.
 *
 * A marketing page for an inbox product should show the inbox. This plays a
 * short scripted conversation -- customer asks, bot answers, agent takes over
 * -- which communicates the actual product in about eight seconds and gives
 * the hero a moving focal point that is content rather than decoration.
 *
 * Three deliberate constraints:
 *
 *   - The full conversation is present in the DOM from the first frame, with
 *     unsent turns hidden via visibility, so the panel reserves its final
 *     height immediately and the hero never reflows as messages arrive.
 *   - It stops when scrolled out of view. A loop running behind the fold burns
 *     battery for nobody.
 *   - Under prefers-reduced-motion the whole thread renders at once, no timers
 *     at all. The information is the point; the animation is the delivery.
 *
 * It is aria-hidden: the surrounding copy already says what the product does,
 * and narrating a looping fake chat to a screen reader is noise.
 */

type Turn = {
  from: "them" | "bot" | "agent";
  text: string;
  /** Milliseconds to hold before this turn appears. */
  delay: number;
};

const SCRIPT: Turn[] = [
  { from: "them", text: "Hi, do you have the 4-camera CCTV kit in stock?", delay: 600 },
  {
    from: "bot",
    text: "Yes — the 4-camera kit is in stock at AED 1,450, including installation.",
    delay: 1500,
  },
  { from: "them", text: "Can someone install it this Saturday?", delay: 1600 },
  { from: "agent", text: "Saturday 10am works. I'll send the quotation now.", delay: 1800 },
];

const TOTAL = SCRIPT.reduce((sum, t) => sum + t.delay, 0);

export function InboxPreview() {
  const i18n = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  // -1 renders the empty thread; SCRIPT.length renders all of it.
  const [shown, setShown] = useState(-1);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(SCRIPT.length);
      return;
    }

    let timers: ReturnType<typeof setTimeout>[] = [];
    const clear = () => {
      for (const t of timers) clearTimeout(t);
      timers = [];
    };

    const play = () => {
      clear();
      setShown(-1);
      setTyping(false);
      let at = 0;
      SCRIPT.forEach((turn, i) => {
        // Show the typing indicator for the tail of each pause, but only for
        // the side that is about to reply -- a customer does not watch
        // themselves type.
        if (turn.from !== "them") {
          timers.push(setTimeout(() => setTyping(true), at + Math.max(0, turn.delay - 700)));
        }
        at += turn.delay;
        timers.push(
          setTimeout(() => {
            setTyping(false);
            setShown(i);
          }, at),
        );
      });
      // Hold the finished thread, then start over.
      timers.push(setTimeout(play, at + 4200));
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) play();
        else clear();
      },
      { threshold: 0.25 },
    );
    observer.observe(node);

    return () => {
      observer.disconnect();
      clear();
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className="relative mx-auto w-full max-w-sm select-none lg:max-w-[22rem]"
      style={{ minHeight: 384 }}
    >
      {/* Glass panel. The blur sits over the hero's gradient field, which is
          what gives the depth -- on a flat background it would read as grey. */}
      <div className="overflow-hidden rounded-3xl border border-white/40 bg-card/70 shadow-2xl backdrop-blur-xl dark:border-white/10">
        <div className="flex items-center gap-3 border-b border-border/60 bg-card/60 px-4 py-3">
          <img
            src="/store-avatar.png"
            alt={i18n.t("inboxPreview.aToZSecurityTrading")}
            width={36}
            height={36}
            className="size-9 shrink-0 rounded-full object-cover ring-1 ring-border"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {i18n.t("inboxPreview.aToZSecurityTrading")}
            </p>
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              {i18n.tr("inboxPreview.whatsappBusiness", {
                span: <span className="size-1.5 rounded-full bg-brand" />,
              })}
            </p>
          </div>
        </div>

        <div className="flex h-80 flex-col justify-end gap-2.5 p-4">
          {SCRIPT.map((turn, i) => {
            const visible = i <= shown;
            const mine = turn.from !== "them";
            return (
              <div
                key={i}
                className={mine ? "flex justify-end" : "flex justify-start"}
                style={{
                  // Reserves height from the first frame; only opacity and
                  // transform change, so nothing reflows mid-animation.
                  visibility: visible ? "visible" : "hidden",
                  opacity: visible ? 1 : 0,
                  transform: visible ? "none" : "translateY(8px)",
                  transition: "opacity 320ms ease-out, transform 320ms cubic-bezier(0.22,1,0.36,1)",
                }}
              >
                <div
                  className={
                    mine
                      ? "max-w-[82%] rounded-2xl rounded-ee-sm bg-brand px-3 py-2 text-[13px] leading-snug text-brand-foreground shadow-sm"
                      : "max-w-[82%] rounded-2xl rounded-es-sm bg-muted px-3 py-2 text-[13px] leading-snug shadow-sm"
                  }
                >
                  {turn.from === "bot" && (
                    <span className="mb-1 flex items-center gap-1 text-[10px] font-semibold opacity-80">
                      <Bot className="size-3" /> Flas AI
                    </span>
                  )}
                  {turn.from === "agent" && (
                    <span className="mb-1 block text-[10px] font-semibold opacity-80">
                      {i18n.t("inboxPreview.fatima")}
                    </span>
                  )}
                  {turn.text}
                  {mine && (
                    <span className="mt-1 flex justify-end opacity-70">
                      {turn.from === "agent" ? (
                        <CheckCheck className="size-3" />
                      ) : (
                        <Check className="size-3" />
                      )}
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {/* Typing indicator, absolutely positioned so it cannot push the
              thread around as it appears and disappears. */}
          <div
            className="flex justify-end"
            style={{
              height: 0,
              opacity: typing ? 1 : 0,
              transition: "opacity 200ms ease-out",
            }}
          >
            <span className="flex -translate-y-1 items-center gap-1 rounded-full bg-muted px-3 py-1.5">
              {[0, 1, 2].map((d) => (
                <span
                  key={d}
                  className="size-1.5 rounded-full bg-muted-foreground/60"
                  style={{
                    animation: "flas-typing 1.1s ease-in-out infinite",
                    animationDelay: `${d * 160}ms`,
                  }}
                />
              ))}
            </span>
          </div>
        </div>
      </div>

      {/* Two floating chips that say what just happened in the thread. */}
      <span
        className="flas-drift absolute -start-20 top-1/3 hidden items-center gap-1.5 rounded-full border border-white/40 bg-card/90 px-3 py-1.5 text-[11px] font-medium shadow-lg backdrop-blur-md lg:flex dark:border-white/10"
        style={{ animationDelay: "-2s" }}
      >
        <Bot className="size-3.5 text-brand" /> {i18n.t("inboxPreview.aiRepliedIn2s")}
      </span>
      <span
        className="flas-drift absolute -end-16 bottom-12 hidden items-center gap-1.5 rounded-full border border-white/40 bg-card/90 px-3 py-1.5 text-[11px] font-medium shadow-lg backdrop-blur-md lg:flex dark:border-white/10"
        style={{ animationDelay: "-5s" }}
      >
        {i18n.tr("inboxPreview.quotationSent", {
          span: <span className="size-1.5 rounded-full bg-brand" />,
        })}
      </span>

      <span className="sr-only">{i18n.t("inboxPreview.anIllustrationOfTheFlas")}</span>
    </div>
  );
}

/** Progress through the scripted conversation, exported for tests/tuning. */
export const PREVIEW_DURATION_MS = TOTAL;
