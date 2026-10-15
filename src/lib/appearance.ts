export const APPEARANCE_KEY = "flas-appearance-v1";
export type ThemeChoice = "light" | "grey" | "dark" | "system";
export type Appearance = {
  theme: ThemeChoice;
  density: "comfortable" | "compact";
  effects: boolean;
  motion: boolean;
  wallpaper: boolean;
};
export const DEFAULT_APPEARANCE: Appearance = {
  theme: "light",
  density: "comfortable",
  effects: true,
  motion: true,
  wallpaper: true,
};
export function parseAppearance(value: unknown): Appearance {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    theme: ["light", "grey", "dark", "system"].includes(String(row["theme"]))
      ? (row["theme"] as ThemeChoice)
      : "light",
    density: row["density"] === "compact" ? "compact" : "comfortable",
    effects: typeof row["effects"] === "boolean" ? row["effects"] : true,
    motion: typeof row["motion"] === "boolean" ? row["motion"] : true,
    wallpaper: typeof row["wallpaper"] === "boolean" ? row["wallpaper"] : true,
  };
}
export function resolvedTheme(theme: ThemeChoice, systemDark: boolean) {
  return theme === "system" ? (systemDark ? "dark" : "light") : theme;
}
export function readAppearance(storage: Pick<Storage, "getItem">): Appearance {
  try {
    return parseAppearance(JSON.parse(storage.getItem(APPEARANCE_KEY) ?? "null"));
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}
export function applyAppearance(root: HTMLElement, value: Appearance, systemDark: boolean) {
  const theme = resolvedTheme(value.theme, systemDark);
  root.classList.toggle("dark", theme === "dark");
  root.dataset["theme"] = theme;
  root.dataset["density"] = value.density;
  root.dataset["effects"] = value.effects ? "on" : "off";
  root.dataset["motion"] = value.motion ? "on" : "off";
  root.dataset["wallpaper"] = value.wallpaper ? "on" : "off";
  root.style.colorScheme = theme === "dark" ? "dark" : "light";
}
// Fixed local preference bootstrap before first paint. No user content, secrets,
// network calls or database state are interpolated into this script.
export const APPEARANCE_BOOTSTRAP = `(()=>{try{const p=JSON.parse(localStorage.getItem('flas-appearance-v1')||'null')||{};const r=document.documentElement;const t=['light','grey','dark','system'].includes(p.theme)?p.theme:'light';const v=t==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):t;r.classList.toggle('dark',v==='dark');r.dataset.theme=v;r.dataset.density=p.density==='compact'?'compact':'comfortable';for(const k of ['effects','motion','wallpaper'])r.dataset[k]=p[k]===false?'off':'on';r.style.colorScheme=v==='dark'?'dark':'light'}catch{}})()`;
