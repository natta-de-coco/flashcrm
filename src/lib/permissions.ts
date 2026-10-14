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
export type StaffRole =
  "super_admin" | "company_admin" | "marketing_manager" | "staff" | "seo_editor";

/** Every route the sidebar can offer, so a typo cannot silently grant nothing. */
export const ALL_ROUTES = [
  "/dashboard",
  "/inbox",
  "/contacts",
  "/marketing",
  "/social",
  "/content",
  "/seo-blog",
  "/advisor",
  "/campaign-planner",
  "/sales",
  "/catalog",
  "/chatbot",
  "/monitoring",
  "/connect",
  "/settings",
] as const;
export type AppRoute = (typeof ALL_ROUTES)[number];

const MARKETING: AppRoute[] = [
  "/dashboard",
  "/inbox",
  "/contacts",
  "/marketing",
  "/social",
  "/content",
  "/seo-blog",
  "/campaign-planner",
  "/advisor",
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

/** All an unknown or not-yet-loaded role may reach: the landing screen, nothing else. */
const NOTHING_PRIVILEGED: readonly AppRoute[] = ["/dashboard"];

/**
 * An unknown or missing role gets the most limited view rather than the widest.
 * A profile row that has not loaded yet must not flash the whole sidebar, and a
 * role this file has never heard of (a typo, a role added to the database before
 * it was added here) fails closed instead of being treated as "Staff".
 */
export function routesFor(role: string | null | undefined): readonly AppRoute[] {
  if (!role) return NOTHING_PRIVILEGED;
  return Object.prototype.hasOwnProperty.call(ROUTES_BY_ROLE, role)
    ? ROUTES_BY_ROLE[role as StaffRole]
    : NOTHING_PRIVILEGED;
}

/**
 * Pages for platform staff only: the people who run Flas, not a company's team.
 * They live under /companies. A company role, even a company admin, never gets
 * them, and the role is the profile's own `staff_role`, the same value the
 * server-side `is_super_admin` check reads.
 */
export function isPlatformRoute(to: string): boolean {
  const path = cleanPath(to);
  return path === "/companies" || path.startsWith("/companies/");
}

/** "/seo-blog/studio?x=1" → "/seo-blog/studio". */
function cleanPath(to: string): string {
  const path = to.split(/[?#]/)[0] ?? "";
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/** The screen in ALL_ROUTES a path belongs to: /seo-blog/studio belongs to /seo-blog. */
function appRouteOf(to: string): AppRoute | undefined {
  const path = cleanPath(to);
  return ALL_ROUTES.find((route) => path === route || path.startsWith(`${route}/`));
}

/**
 * THE rule for what a role may open from anywhere in the app: the sidebar, the
 * phone bar, search and "+ Create" all ask this and nothing else, so they cannot
 * disagree. A path that is not a known screen is not reachable (deny by
 * default). This decides what is OFFERED. It is not the security boundary: every
 * server function and every table policy checks for itself, and a direct URL is
 * not stopped by this.
 */
export function canOpen(role: string | null | undefined, to: string): boolean {
  if (isPlatformRoute(to)) return role === "super_admin";
  const screen = appRouteOf(to);
  return screen !== undefined && routesFor(role).includes(screen);
}

/** Kept for existing callers; same rule as canOpen. */
export function canReach(role: string | null | undefined, to: string): boolean {
  return canOpen(role, to);
}

/**
 * Which kinds of record search may run for a role. Search shows a record only to
 * someone who can open the screen that record lives on, so a role with no
 * customer screen gets no customer results and the query is never sent.
 */
export const RECORD_SEARCH_SCREENS = {
  contacts: "/contacts",
  products: "/catalog",
  articles: "/seo-blog",
} as const;
export type RecordKind = keyof typeof RECORD_SEARCH_SCREENS;

export function searchableRecords(role: string | null | undefined): Record<RecordKind, boolean> {
  return {
    contacts: canOpen(role, RECORD_SEARCH_SCREENS.contacts),
    products: canOpen(role, RECORD_SEARCH_SCREENS.products),
    articles: canOpen(role, RECORD_SEARCH_SCREENS.articles),
  };
}

/** Only these roles may manage teammates, billing and connections. */
export function isCompanyManager(role: string | null | undefined): boolean {
  return role === "company_admin" || role === "super_admin";
}

/** Labels and one-line explanations, shown wherever a role is chosen. */
export const ROLE_LABELS: Record<
  Exclude<StaffRole, "super_admin">,
  { label: string; hint: string }
> = {
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
    hint: "Website & SEO and saved drafts only. No inbox, no customer data.",
  },
};
