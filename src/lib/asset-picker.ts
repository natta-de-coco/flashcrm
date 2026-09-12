/*
 * Pure logic behind AssetPicker: search, selection and the small bits of copy
 * that depend on counts. Kept free of React and of any component import so
 * the search behaviour and single/multi selection semantics can be unit
 * tested directly, without rendering anything.
 *
 * Browser-safe, no server imports -- this runs in the picker on every
 * keystroke.
 */
import type { ConnectableAsset } from "@/lib/connection-problem";

/**
 * Case-insensitive substring match over name, secondary line and kind. A
 * blank query (after trimming) matches everything, so callers can always run
 * assets through this rather than branching on "is there a query".
 */
export function filterAssets(
  assets: readonly ConnectableAsset[] | undefined,
  query: string,
): ConnectableAsset[] {
  const list = assets ?? [];
  const q = query.trim().toLowerCase();
  if (!q) return [...list];
  return list.filter((asset) => {
    const haystack = [asset.name, asset.secondary, asset.kind]
      .filter((part): part is string => Boolean(part))
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

/**
 * The one or two letters an avatar shows when there is no image: the first
 * letter of the first two words, or the first two letters of a single word.
 * "Acme Retail" -> "AR", "flas" -> "FL". Never throws on an empty string.
 */
export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0]}${words[1]![0]}`.toUpperCase();
}

/**
 * What choosing `id` does to the current selection, given the picker's mode.
 * Single mode always replaces the selection outright; multi mode toggles the
 * one id in or out. One function so the component and its tests agree on
 * exactly what "select" means in each mode.
 */
export function nextSelection(
  selected: readonly string[],
  id: string,
  mode: "single" | "multi",
): string[] {
  if (mode === "single") return [id];
  return selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
}

/**
 * Naive but sufficient pluralization for the short nouns this picker deals in
 * ("Page", "channel", "ad account", "Google Business Profile location"...).
 * `count` singularizes when it is exactly 1; anything else (including the
 * default) pluralizes.
 */
export function pluralNoun(noun: string, count = 2): string {
  if (count === 1) return noun;
  if (noun.toLowerCase().endsWith("s")) return noun;
  return `${noun}s`;
}

/** Copy for the picker's aria-live result count, kept in sync with what's rendered. */
export function resultSummary(shown: number, total: number, noun: string): string {
  if (total === 0) return `No ${pluralNoun(noun)} available`;
  if (shown === total) return `Showing all ${shown} ${pluralNoun(noun, shown)}`;
  return `Showing ${shown} of ${total} ${pluralNoun(noun, total)}`;
}
