import { isCompanyManager } from "./permissions";

export const SETTINGS_SECTIONS = [
  { id: "profile", group: "account", manager: false, keywords: "name personal profile account" },
  {
    id: "appearance",
    group: "account",
    manager: false,
    keywords: "appearance light grey gray dark system theme motion gradients wallpaper density",
  },
  {
    id: "security",
    group: "account",
    manager: false,
    keywords: "password authentication security 2fa",
  },
  {
    id: "company",
    group: "workspace",
    manager: true,
    keywords: "company business country currency timezone language region tax vat trn address",
  },
  {
    id: "invoices",
    group: "workspace",
    manager: true,
    keywords: "logo brand branding invoice quotation payment terms",
  },
  {
    id: "notifications",
    group: "workspace",
    manager: true,
    keywords: "notifications lead alerts email whatsapp phone",
  },
  {
    id: "team",
    group: "workspace",
    manager: true,
    keywords: "team staff members permissions invite access",
  },
  {
    id: "billing",
    group: "workspace",
    manager: true,
    keywords: "billing subscription plan renewal payments",
  },
  {
    id: "connections",
    group: "workspace",
    manager: true,
    keywords:
      "integrations connect facebook instagram whatsapp google youtube ai api keys email smtp",
  },
  {
    id: "privacy",
    group: "workspace",
    manager: true,
    keywords: "privacy data export deletion audit logs history",
  },
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["id"];

export function settingsSectionsFor(role: string | null | undefined) {
  return SETTINGS_SECTIONS.filter((section) => !section.manager || isCompanyManager(role));
}

export function parseSettingsSearch(search: Record<string, unknown>): {
  section?: SettingsSection;
} {
  const id = search["section"];
  return SETTINGS_SECTIONS.some((section) => section.id === id)
    ? { section: id as SettingsSection }
    : {};
}

export function selectedSettingsSection(
  section: unknown,
  role: string | null | undefined,
): SettingsSection {
  const allowed = settingsSectionsFor(role);
  return (
    allowed.find((item) => item.id === section)?.id ??
    (isCompanyManager(role) ? "company" : "profile")
  );
}

export type SettingsDraft<T> = {
  scope: string;
  draft: T;
  baseline: T;
  latestSource: T;
  loaded: boolean;
};
export function createSettingsDraft<T>(scope: string, empty: T, source?: T): SettingsDraft<T> {
  return {
    scope,
    draft: source ?? empty,
    baseline: source ?? empty,
    latestSource: source ?? empty,
    loaded: source !== undefined,
  };
}
export function settingsDraftDirty<T>(state: SettingsDraft<T>): boolean {
  return state.loaded && JSON.stringify(state.draft) !== JSON.stringify(state.baseline);
}
/** A refetch can refresh clean fields; it must never erase someone's edits. */
export function synchronizeSettingsDraft<T>(
  state: SettingsDraft<T>,
  scope: string,
  empty: T,
  source?: T,
): SettingsDraft<T> {
  if (state.scope !== scope) return createSettingsDraft(scope, empty, source);
  if (source === undefined) return state;
  if (settingsDraftDirty(state))
    return JSON.stringify(source) === JSON.stringify(state.latestSource)
      ? state
      : { ...state, latestSource: source };
  if (state.loaded && JSON.stringify(source) === JSON.stringify(state.baseline)) return state;
  return createSettingsDraft(scope, empty, source);
}

export function acknowledgeSettingsDraft<T>(
  state: SettingsDraft<T>,
  saved: Partial<T>,
): SettingsDraft<T> {
  return {
    ...state,
    baseline: { ...state.baseline, ...saved },
    latestSource: { ...state.latestSource, ...saved },
  };
}

export function resetSettingsDraft<T>(state: SettingsDraft<T>): SettingsDraft<T> {
  return { ...state, draft: state.latestSource, baseline: state.latestSource };
}

export function shouldLeaveSettings(dirty: boolean, nextPath: string): boolean {
  return dirty && nextPath.replace(/\/$/, "") !== "/settings";
}
