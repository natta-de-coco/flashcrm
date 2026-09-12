import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CapabilityList, type CapabilityItem } from "@/components/integrations/CapabilityList";
import { initialsFor } from "@/lib/asset-picker";
import { cn } from "@/lib/utils";
import { CheckCircle2 } from "lucide-react";

export type ConnectionSuccessProps = {
  /** The specific thing that got connected, e.g. "Acme Retail". */
  assetName: string;
  /** "Facebook Page", "YouTube channel"... drives both the headline and the badge next to the name. */
  assetKind: string;
  capabilities: CapabilityItem[];
  /** Lowercase singular noun for "Connect another <noun>", e.g. "Page", "channel". Falls back to assetKind. */
  noun?: string | undefined;
  avatarUrl?: string | null | undefined;
  /** Any action whose handler is absent is not rendered at all -- there is no disabled "View connection" button. */
  onViewConnection?: (() => void) | undefined;
  onConnectAnother?: (() => void) | undefined;
  onDone?: (() => void) | undefined;
  className?: string | undefined;
};

/**
 * The screen shown right after a connection succeeds: confirms what got
 * connected, what it can do, and where to go next. Purely presentational --
 * the caller decides what "View connection" etc. actually do, or leaves them
 * out by not passing a handler.
 */
export function ConnectionSuccess({
  assetName,
  assetKind,
  capabilities,
  noun,
  avatarUrl,
  onViewConnection,
  onConnectAnother,
  onDone,
  className,
}: ConnectionSuccessProps) {
  const connectAnotherNoun = noun ?? assetKind;
  const hasActions = Boolean(onViewConnection || onConnectAnother || onDone);

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="size-5 shrink-0" />
        <h2 className="break-words text-base font-semibold">{assetKind} connected</h2>
      </div>

      <div className="flex items-center gap-3 rounded-lg border p-3">
        <Avatar className="size-10 shrink-0">
          {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
          <AvatarFallback className="text-xs font-medium">{initialsFor(assetName)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="break-words text-sm font-medium">{assetName}</span>
            <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px] font-normal">
              {assetKind}
            </Badge>
          </div>
        </div>
      </div>

      <CapabilityList capabilities={capabilities} />

      {hasActions ? (
        <div className="flex flex-wrap gap-2">
          {onViewConnection ? (
            <Button type="button" size="sm" onClick={onViewConnection}>
              View connection
            </Button>
          ) : null}
          {onConnectAnother ? (
            <Button type="button" size="sm" variant="outline" onClick={onConnectAnother}>
              Connect another {connectAnotherNoun}
            </Button>
          ) : null}
          {onDone ? (
            <Button type="button" size="sm" variant="ghost" onClick={onDone}>
              Done
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
