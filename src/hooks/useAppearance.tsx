import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  APPEARANCE_KEY,
  DEFAULT_APPEARANCE,
  applyAppearance,
  readAppearance,
  type Appearance,
} from "@/lib/appearance";
const AppearanceContext = createContext({
  preferences: DEFAULT_APPEARANCE,
  update: (_value: Partial<Appearance>) => {},
  storageAvailable: true,
});
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [ready, setReady] = useState(false);
  const latest = useRef(preferences);
  latest.current = preferences;
  useEffect(() => {
    let value = { ...DEFAULT_APPEARANCE };
    try {
      window.localStorage.getItem(APPEARANCE_KEY);
      value = readAppearance(window.localStorage);
    } catch {
      setStorageAvailable(false);
    }
    setPreferences(value);
    setReady(true);
    const onStorage = (event: StorageEvent) => {
      if (event.key === APPEARANCE_KEY || event.key === null) {
        try {
          setPreferences(readAppearance(window.localStorage));
        } catch {
          setStorageAvailable(false);
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => applyAppearance(document.documentElement, preferences, media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [preferences, ready]);
  const update = (patch: Partial<Appearance>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setPreferences(next);
    try {
      window.localStorage.setItem(APPEARANCE_KEY, JSON.stringify(next));
      setStorageAvailable(true);
    } catch {
      setStorageAvailable(false);
    }
  };
  return (
    <AppearanceContext.Provider value={{ preferences, update, storageAvailable }}>
      {children}
    </AppearanceContext.Provider>
  );
}
export const useAppearance = () => useContext(AppearanceContext);
