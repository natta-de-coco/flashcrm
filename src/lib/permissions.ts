/**
 * What each role inside a company may reach.
 *
 * The five staff roles existed in the database and in team_invites long before
 * anything read them: every signed-in user saw the whole sidebar regardless of
 * role, so "assign a limited role" changed a badge and nothing else. This is
 * the single place that turns a role into access, so a company admin handing
 * someone the "Staff" role is making a real decision.
 *
 * Deny-by-default: a route absent from a role's list is not reachable from the
 * navigation. Server functions keep their own checks -- hiding a link is a
 * usability decision, not a security boundary, and the two must not be
 * confused.
 */
export type StaffRole = "super_admin" | "company_admin" | "marketing_manager" | "staff" | "seo_editor";

/** Every route the sidebar can offer, so a typo cannot silently grant nothing. */
export const ALL_ROUTES = [
  "/dashboard", "/inbox", "/contacts", "/marketing", "/social", "/content", "/seo-blog",
  "/advisor", "/campaign-planner", "/sales", "/catalog", "/chatbot",
  "/monitoring", "/connect", "/settings",
] as const;
export type AppRoute = (typeof ALL_ROUTES)[number];

const MARKETING: AppRoute[] = [
  "/dashboard", "/inbox", "/contacts", "/marketing", "/social", "/content", "/seo-blog",
  "/campaign-planner", "/advisor",
];

/** Front-line agent: the conversation and the customer, not the company's setup. */
const STAFF: AppRoute[] = ["/dashboard", "/inbox", "/contacts", "/sales", "/catalog"];

/** Writes articles; has no business in the inbox or the pipeline. */
const SEO_EDITOR: AppRoute[] = ["/dashboard", "/content", "/seo-blog"];

const ROUTES_BY_ROLE: Record<StaffRole, readonly AppRoute[]> = {
  super_admin: ALL_ROUTES,
  company_admin: ALL_ROUTES,
  marketing_manager: MARKETING,
  staff: STAFF,
  seo_editor: SEO_EDITOR,
};

/**
 * An unknown or missing role gets the most limited view rather than the widest.
 * A profile row that has not loaded yet must not flash the whole sidebar.
 */
export function routesFor(role: string | null | undefined): readonly AppRoute[] {
  if (!role) return SEO_EDITOR.slice(0, 1); // "/dashboard" only
  return ROUTES_BY_ROLE[role as StaffRole] ?? STAFF;
}

export function canReach(role: string | null | undefined, to: string): boolean {
  return routesFor(role).includes(to as AppRoute);
}

/** Only these roles may manage teammates, billing and connections. */
export function isCompanyManager(role: string | null | undefined): boolean {
  return role === "company_admin" || role === "super_admin";
}

/** Labels and one-line explanations, shown wherever a role is chosen. */
export const ROLE_LABELS: Record<Exclude<StaffRole, "super_admin">, { label: string; hint: string }> = {
  company_admin: {
    label: "Company admin",
    hint: "Full access, including billing, integrations and the team.",
  },
  marketing_manager: {
    label: "Marketing manager",
    hint: "Campaigns, social, content and contacts. No billing or connections.",
  },
  staff: {
    label: "Staff",
    hint: "Inbox, contacts, quotes and products. Cannot change company setup.",
  },
  seo_editor: {
    label: "SEO editor",
    hint: "Content and SEO Studio only. No inbox, no customer data.",
  },
};
