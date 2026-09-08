import { cn } from "@/lib/utils";

/**
 * Brand marks.
 *
 * These used to be imported from `*.asset.json` pointer files whose `url` was a
 * root-relative path into Lovable's asset CDN (`/__l5e/assets-v1/...`). No
 * image existed in the repository at all. That resolves on Lovable's own
 * hosting and nowhere else — and this project builds to the Cloudflare preset,
 * so every logo on the site (landing page, blog, auth, onboarding, the app
 * header) would have 404'd the moment it was deployed anywhere else.
 *
 * The files now live in `public/`, so they are served by whoever serves the
 * app.
 *
 * Both carry explicit intrinsic width and height. The browser can then reserve
 * the right box before the image arrives, which keeps the header from shifting
 * on load — the logo sits above the fold on every marketing page, where layout
 * shift is both visible and scored.
 *
 * Known follow-up: the source files are 2172x724 and 1254x1254, far larger
 * than the ~144px and ~40px they render at. Re-encoding them to roughly 600px
 * and 256px WebP takes them from 429KB and 621KB to about 16KB and 17KB. Worth
 * doing before a real traffic push.
 */

/** Official Flas round mark inside a white badge — legible on any background. */
export function FlashLogoBadge({
  className,
  imgClassName,
}: {
  className?: string;
  imgClassName?: string;
}) {
  return (
    <span
      className={cn(
        "grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-white shadow-sm ring-1 ring-black/10",
        className,
      )}
    >
      <img
        src="/flas-round-logo.png"
        alt="Flas"
        width={1254}
        height={1254}
        className={cn("size-full object-contain", imgClassName)}
      />
    </span>
  );
}

/** Official horizontal Flas wordmark for wide headers and brand surfaces. */
export function FlasWordmark({ className }: { className?: string }) {
  return (
    <img
      src="/flas-logo.png"
      alt="Flas"
      width={2172}
      height={724}
      className={cn("h-9 w-auto object-contain", className)}
    />
  );
}
