export type Appearance = "light" | "dark" | "system";
export const APPEARANCE_KEY = "flas.appearance";

export function appearanceOf(value: unknown): Appearance {
  return value === "light" || value === "dark" ? value : "system";
}

export function isDarkAppearance(appearance: Appearance, systemDark: boolean): boolean {
  return appearance === "dark" || (appearance === "system" && systemDark);
}

// Fixed code only; no user-provided values are interpolated into this script.
// The first paint matches the saved preference before React hydrates.
export const appearanceBootScript = `try{var a=localStorage.getItem("${APPEARANCE_KEY}");document.documentElement.classList.toggle("dark",a==="dark"||(a!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches));}catch{}`;
