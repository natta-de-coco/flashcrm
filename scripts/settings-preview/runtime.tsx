import { createContext, useContext, Fragment, type ReactNode } from "react";
import { translate, directionOf, hasMessage } from "@/lib/i18n";
export const FixtureContext = createContext({
  scope: "demo-A",
  role: "company_admin",
  language: "en",
});
export function useAuth() {
  const { scope } = useContext(FixtureContext);
  return { user: { id: scope, email: "demo@example.test" }, isAdmin: true };
}
export function useTenant() {
  const { scope, role } = useContext(FixtureContext);
  return {
    tenant: {
      id: scope,
      name: scope === "demo-A" ? "Demo Trading A" : "Demo Trading B",
      timezone: scope === "demo-A" ? "Asia/Dubai" : "Europe/London",
    },
    staffRole: role,
    refresh: async () => {},
  };
}
export function useI18n() {
  const { language } = useContext(FixtureContext);
  const t = (key: string, values?: Record<string, string | number>) =>
    translate(language, key, values);
  return {
    language,
    dir: directionOf(language),
    t,
    tx: (key: string, fallback: string) => (hasMessage(key) ? t(key) : fallback),
    tr: (key: string, nodes: Record<string, ReactNode>) =>
      t(key)
        .split(/(\{\w+\})/g)
        .map((part, index) => {
          const name = /^\{(\w+)\}$/.exec(part)?.[1];
          return name && name in nodes ? <Fragment key={index}>{nodes[name]}</Fragment> : part;
        }),
  };
}
