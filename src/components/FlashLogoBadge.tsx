import { cn } from "@/lib/utils";
import flashLogoAsset from "@/assets/flash-logo.png.asset.json";

/** Flash wordmark inside a white circular badge — legible on any background. */
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
      <img src={flashLogoAsset.url} alt="Flash" className={cn("w-[74%]", imgClassName)} />
    </span>
  );
}
