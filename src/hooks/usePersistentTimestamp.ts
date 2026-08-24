import { useEffect, useState } from "react";

/**
 * Tracks a query's last-successful-update time and mirrors it into
 * localStorage, so the "Updated HH:MM:SS" label survives page reloads and
 * stays visible until the next successful refresh replaces it.
 *
 * Reads storage only after mount (no hydration mismatch) and formats the
 * stored epoch with the user's locale on every render pass.
 */
export function usePersistentTimestamp(key: string, dataUpdatedAt: number): string | null {
  const [storedAt, setStoredAt] = useState<number | null>(null);

  // Hydrate from localStorage after mount.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      const value = raw ? Number(raw) : 0;
      if (Number.isFinite(value) && value > 0) setStoredAt(value);
    } catch {
      /* storage unavailable — ignore */
    }
  }, [key]);

  // Persist each fresh successful fetch.
  useEffect(() => {
    if (!dataUpdatedAt) return;
    try {
      window.localStorage.setItem(key, String(dataUpdatedAt));
    } catch {
      /* storage unavailable — ignore */
    }
    setStoredAt(dataUpdatedAt);
  }, [key, dataUpdatedAt]);

  return storedAt ? new Date(storedAt).toLocaleTimeString() : null;
}
