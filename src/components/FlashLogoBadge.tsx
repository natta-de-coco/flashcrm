import { cn } from "@/lib/utils";
import flasLogoAsset from "@/assets/flas-logo.png.asset.json";
import flasRoundLogoAsset from "@/assets/flas-round-logo.png.asset.json";

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
        src={flasRoundLogoAsset.url}
        alt="Flas"
        className={cn("size-full object-contain", imgClassName)}
      />
    </span>
  );
}

/** Official horizontal Flas wordmark for wide headers and brand surfaces. */
export function FlasWordmark({
  className,
}: {
  className?: string;
}) {
  return (
    <img
      src={flasLogoAsset.url}
      alt="Flas"
      className={cn("h-9 w-auto object-contain", className)}
    />
  );
}
