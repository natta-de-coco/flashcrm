/**
 * Recovery from stale code-split chunks.
 *
 * Each route's code is its own file with a content hash in its name. When a
 * new version is published, the old files are gone, but anyone who already had
 * the app open still holds the old list of file names. Their next navigation
 * to a page they have not loaded yet asks for a file that no longer exists, the
 * import fails, and they land on "This page didn't load". The error boundary's
 * "Try again" re-requests the same missing file, so it fails every time; only a
 * full reload, which fetches the new list, works.
 *
 * Production telemetry recorded this as the most frequent error boundary
 * incident ("Failed to fetch dynamically imported module", 8 times).
 */

const RELOAD_KEY = "flas:stale-chunk-reload-at";

/** Never reload twice within this window: a genuinely missing file must not loop. */
export const STALE_CHUNK_RELOAD_WINDOW_MS = 30_000;

/**
 * Whether an error is a failed load of a code-split chunk. Each browser words
 * it differently: Chrome, Firefox and Safari, plus Vite's own CSS preload.
 */
export function isStaleChunkError(error: unknown): boolean {
  const text =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === "string"
        ? error
        : "";
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError/i.test(
    text,
  );
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/**
 * Reloads the page once. Returns true if a reload was started, false if one
 * already happened within the window -- then the file really is missing, and
 * the caller should report it rather than try again.
 */
export function reloadForStaleChunk(
  now: number = Date.now(),
  storage: StorageLike | null = safeSessionStorage(),
  reload: () => void = () => window.location.reload(),
): boolean {
  // Without storage there is no loop guard, so do not reload automatically.
  if (!storage) return false;
  try {
    const last = Number(storage.getItem(RELOAD_KEY) ?? 0);
    if (Number.isFinite(last) && now - last < STALE_CHUNK_RELOAD_WINDOW_MS) return false;
    storage.setItem(RELOAD_KEY, String(now));
  } catch {
    return false;
  }
  reload();
  return true;
}

function safeSessionStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/**
 * Vite fires `vite:preloadError` in production builds when a chunk or its CSS
 * fails to load. Reloading there recovers before the error boundary is shown.
 * preventDefault stops the error from also being thrown into the app.
 */
export function installStaleChunkRecovery() {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadForStaleChunk()) event.preventDefault();
  });
}
