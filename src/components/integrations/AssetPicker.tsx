import * as React from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import {
  filterAssets,
  initialsFor,
  nextSelection,
  pluralNoun,
  resultSummary,
} from "@/lib/asset-picker";
import type { ConnectableAsset } from "@/lib/connection-problem";
import { cn } from "@/lib/utils";
import { AlertTriangle, Check, Loader2, RotateCw, Search } from "lucide-react";

export type AssetPickerMode = "single" | "multi";

export type AssetPickerProps = {
  /** undefined before the caller has fetched anything -- distinct from an empty, loaded list. */
  assets: ConnectableAsset[] | undefined;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  mode: AssetPickerMode;
  /** Ids of the selected assets. Always an array, even in single mode (0 or 1 entries). */
  selected: string[];
  onChange: (ids: string[]) => void;
  onConfirm: () => void;
  confirming: boolean;
  confirmLabel: string;
  /** Singular noun for one asset -- "Page", "channel", "location", "ad account". Pluralized for copy. */
  noun: string;
  /** Shown when the caller has genuinely nothing to offer (no assets at all). */
  emptyTitle: string;
  emptyMessage: string;
  searchPlaceholder: string;
  className?: string | undefined;
};

/**
 * One picker for anything a login can hand back several of: Facebook Pages,
 * Instagram professional accounts, YouTube channels, LinkedIn organizations,
 * Business Profile locations, analytics properties, ad accounts. The caller
 * fetches and owns state; this component only renders what it is given and
 * reports choices back through onChange/onConfirm.
 *
 * Single mode is a radiogroup (native roving-tabindex, arrow keys, Space/
 * Enter). Multi mode is a list of checkboxes, each its own Tab stop, Space to
 * toggle -- the standard pattern for an independent checkbox list, not a
 * radiogroup with boxes instead of dots.
 */
export function AssetPicker({
  assets,
  loading,
  error,
  onRetry,
  mode,
  selected,
  onChange,
  onConfirm,
  confirming,
  confirmLabel,
  noun,
  emptyTitle,
  emptyMessage,
  searchPlaceholder,
  className,
}: AssetPickerProps) {
  const baseId = React.useId();
  const [query, setQuery] = React.useState("");

  const list = assets ?? [];
  const filtered = filterAssets(list, query);

  const hasAnyAssets = !loading && !error && list.length > 0;
  const showList = hasAnyAssets && filtered.length > 0;
  const showNoMatches = hasAnyAssets && filtered.length === 0;
  const showEmpty = !loading && !error && list.length === 0;

  const select = (id: string) => onChange(nextSelection(selected, id, mode));

  const rows = filtered.map((asset) => (
    <AssetRow
      key={asset.id}
      asset={asset}
      mode={mode}
      checked={selected.includes(asset.id)}
      inputId={`${baseId}-${asset.id}`}
      onSelect={select}
    />
  ));

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {hasAnyAssets && (
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="h-9 pl-8 text-sm"
          />
        </div>
      )}

      {hasAnyAssets && (
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {resultSummary(filtered.length, list.length, noun)}
        </p>
      )}

      {loading && (
        <div role="status" aria-live="polite" className="flex flex-col gap-2">
          <span className="sr-only">{`Loading ${pluralNoun(noun)}…`}</span>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      )}

      {!loading && error && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>{`Couldn't load ${pluralNoun(noun)}`}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p className="break-words">{error}</p>
            <Button type="button" size="sm" variant="outline" onClick={onRetry}>
              <RotateCw className="size-3.5" />
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {showEmpty && (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm font-medium">{emptyTitle}</p>
          <p className="mt-1 text-xs text-muted-foreground">{emptyMessage}</p>
        </div>
      )}

      {showNoMatches && (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm font-medium">No matches</p>
          <p className="mt-1 break-words text-xs text-muted-foreground">
            Nothing matches &quot;{query.trim()}&quot;. Try a different search.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => setQuery("")}
          >
            Clear search
          </Button>
        </div>
      )}

      {showList &&
        (mode === "single" ? (
          <RadioGroup
            aria-label={`${noun} options`}
            value={selected[0] ?? ""}
            onValueChange={select}
            className="flex flex-col gap-2"
          >
            {rows}
          </RadioGroup>
        ) : (
          <div role="group" aria-label={`${noun} options`} className="flex flex-col gap-2">
            {rows}
          </div>
        ))}

      {hasAnyAssets && (
        <div className="flex items-center justify-between gap-2 border-t pt-3">
          {mode === "multi" ? (
            <p className="text-xs text-muted-foreground">{selected.length} selected</p>
          ) : (
            <span />
          )}
          <Button
            type="button"
            size="sm"
            disabled={selected.length === 0 || confirming}
            onClick={onConfirm}
          >
            {confirming ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

function AssetRow({
  asset,
  mode,
  checked,
  inputId,
  onSelect,
}: {
  asset: ConnectableAsset;
  mode: AssetPickerMode;
  checked: boolean;
  inputId: string;
  onSelect: (id: string) => void;
}) {
  const reasonId = !asset.eligible && asset.disabledReason ? `${inputId}-reason` : undefined;

  return (
    <label
      htmlFor={inputId}
      className={cn(
        "flex items-start gap-3 rounded-lg border p-3 transition-colors",
        checked ? "border-primary bg-primary/5" : "border-border",
        asset.eligible ? "cursor-pointer hover:bg-muted/50" : "cursor-not-allowed opacity-60",
      )}
    >
      {mode === "single" ? (
        <RadioGroupItem
          value={asset.id}
          id={inputId}
          disabled={!asset.eligible}
          aria-describedby={reasonId}
          className="mt-0.5 shrink-0"
        />
      ) : (
        <Checkbox
          id={inputId}
          checked={checked}
          disabled={!asset.eligible}
          aria-describedby={reasonId}
          onCheckedChange={() => onSelect(asset.id)}
          className="mt-0.5 shrink-0"
        />
      )}

      <Avatar className="size-9 shrink-0">
        {asset.avatarUrl ? <AvatarImage src={asset.avatarUrl} alt="" /> : null}
        <AvatarFallback className="text-[11px] font-medium">
          {initialsFor(asset.name)}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="break-words text-sm font-medium">{asset.name}</span>
          {asset.kind ? (
            <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px] font-normal">
              {asset.kind}
            </Badge>
          ) : null}
          {asset.alreadyConnected ? (
            <Badge
              variant="secondary"
              className="shrink-0 gap-1 px-1.5 py-0 text-[10px] font-normal"
            >
              <Check className="size-3" />
              Already connected
            </Badge>
          ) : null}
        </div>
        {asset.secondary ? (
          <p className="truncate text-xs text-muted-foreground">{asset.secondary}</p>
        ) : null}
        {!asset.eligible && asset.disabledReason ? (
          <p id={reasonId} className="mt-1 break-words text-xs text-destructive">
            {asset.disabledReason}
          </p>
        ) : null}
      </div>
    </label>
  );
}
