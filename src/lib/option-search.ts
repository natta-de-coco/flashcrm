// How a searchable picker decides what matches. The command list's default is
// a fuzzy score: typing "+966" also listed +996 and +976, and "los ang" listed
// Lower Princes. For codes and offsets that is noise, so a picker matches what
// was typed and nothing else.

/**
 * Lower-cased, without accents, and with the Arabic letter forms people type
 * interchangeably folded together, so "الامارات" finds "الإمارات" and "sao
 * paulo" finds "São Paulo".
 */
export function foldForSearch(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase();
}

/**
 * 0 when the option does not match; otherwise higher is better. Every typed
 * word must appear in the option's label or keywords, in any order. An option
 * that one of its names or codes equals outright comes first, then one that
 * starts with what was typed, then the rest.
 */
export function optionSearchScore(names: readonly string[], search: string): number {
  const words = foldForSearch(search).split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;
  const folded = names.map(foldForSearch);
  const haystack = folded.join(" ");
  if (!words.every((word) => haystack.includes(word))) return 0;
  const whole = words.join(" ");
  if (folded.some((name) => name === whole)) return 1;
  if (folded.some((name) => name.startsWith(whole))) return 0.8;
  return 0.5;
}
