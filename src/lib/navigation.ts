/*
 * The single definition of the app's navigation.
 *
 * This used to live in `routes/_authenticated/route.tsx`, with a second,
 * hand-maintained copy inside CommandPalette. The copies drifted, which is how
 * "Quotes & Invoices" ended up reachable from the sidebar but absent from
 * search: typing "invoice" matched nothing real, so the fuzzy matcher returned
 * the nearest unrelated page instead. Chatbot, Campaign Planner and
 * Integrations were missing from search for the same reason.
 *
 * It cannot live in the route file, because that file imports CommandPalette —
 * importing it back would be a cycle. So both import this.
 *
 * Everything that names a screen reads from here: the sidebar and the phone
 * drawer (NAV_SECTIONS), the phone's bottom bar (MOBILE_BAR_ITEMS), the search
 * palette (PALETTE_PAGES) and the "+ Create" menu (QUICK_CREATE_ACTIONS). They
 * name a screen with the same translation keys (`navMessageKey`), so a rename
 * here is a rename everywhere.
 *
 * The sections follow the job a person is doing — what they do every day,
 * what they sell, how they market, how they set up — rather than the tool that
 * does it. Labels are plain words: "Social posts", not "Social Hub".
 *
 * `keywords` exists because a label is not what a customer types. Nobody
 * searches "Quotes & invoices"; they search "invoice", "bill", "receipt" or
 * "VAT". The names the menu used to have are kept here too, so a person who
 * learned "Social Hub" or "Integrations" still finds the screen. These are
 * matched but never displayed.
 */
import { canOpen } from "./permissions";
import {
  Activity,
  Bot,
  Briefcase,
  Bug,
  Building2,
  FileText,
  Inbox,
  LayoutDashboard,
  Mail,
  Megaphone,
  MessageSquare,
  Package,
  Plug,
  Receipt,
  Settings,
  Sparkles,
  Target,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  to: string;
  label: string;
  desc: string;
  icon: LucideIcon;
  /**
   * Extra search terms. Matched, never rendered. The names an entry used to
   * have go here, so a person who learned "Social Hub" still finds it, and
   * there is never a second, visible entry for the old name.
   */
  keywords?: string;
  /**
   * A shorter name for the phone's bottom bar only, where each slot is a few
   * letters wide. It must be a word taken from the full name, never a new one
   * (tests check this). Its translation key is `nav.<route>.bar`.
   */
  barLabel?: string;
};

export type NavSectionId = "daily" | "sell" | "marketing" | "setup" | "platform";

export type NavSection = {
  /** Names the section's translation key: `nav.section.<id>`. */
  id: NavSectionId;
  /** English; shown only when a translation is missing. */
  title: string;
  items: readonly NavItem[];
};

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    id: "daily",
    title: "Daily",
    items: [
      {
        to: "/dashboard",
        label: "Home",
        desc: "Today at a glance",
        icon: LayoutDashboard,
        keywords: "dashboard overview home start today summary",
      },
      {
        to: "/inbox",
        label: "Inbox",
        desc: "Chats & social messages",
        icon: Inbox,
        keywords: "messages chat conversations whatsapp dm comments instagram facebook replies",
      },
      {
        to: "/contacts",
        label: "Contacts",
        desc: "Customers & pipeline",
        icon: Users,
        keywords: "people customers leads pipeline crm deals",
      },
      {
        to: "/chatbot",
        label: "Chatbot",
        desc: "AI answers your customers",
        icon: Bot,
        keywords: "bot auto reply automation ai answers",
      },
    ],
  },
  {
    id: "sell",
    title: "Sell",
    items: [
      {
        to: "/sales",
        label: "Quotes & invoices",
        desc: "Send PDFs, get paid on WhatsApp",
        icon: Receipt,
        keywords:
          "invoice invoices quote quotation quotations bill billing receipt payment payments tax vat proforma estimate sales pdf",
      },
      {
        to: "/catalog",
        label: "Products",
        desc: "What you sell",
        icon: Package,
        keywords: "products catalog items sku price services",
      },
    ],
  },
  {
    id: "marketing",
    title: "Marketing",
    items: [
      {
        to: "/social",
        label: "Social posts",
        barLabel: "Posts",
        desc: "Write & plan posts (you post them)",
        icon: Megaphone,
        keywords:
          "social hub social media instagram facebook youtube twitter x tiktok linkedin post posts schedule plan caption accounts",
      },
      {
        to: "/seo-blog",
        label: "Website & SEO",
        desc: "Articles for Google + search stats",
        icon: Sparkles,
        keywords:
          "seo studio content & seo content seo saved drafts drafts seo article articles blog writer ai image google search console keywords ranking wordpress website",
      },
      {
        to: "/marketing",
        label: "Leads & email",
        desc: "Capture leads, plan emails",
        icon: Mail,
        keywords:
          "leads & marketing leads marketing email campaigns newsletter drip popup capture forms consent",
      },
      {
        to: "/campaign-planner",
        label: "Campaign planner",
        desc: "AI plan: who, where, what to say",
        icon: Target,
        keywords: "campaign plan audience targeting ads channels",
      },
      {
        to: "/advisor",
        label: "Business advisor",
        desc: "AI growth advice",
        icon: Briefcase,
        keywords: "advice growth strategy ai consultant",
      },
    ],
  },
  {
    id: "setup",
    title: "Set up",
    items: [
      {
        to: "/connect",
        label: "Connect accounts",
        desc: "WhatsApp, Instagram, Facebook, website",
        icon: Plug,
        keywords:
          "integrations connect setup whatsapp api keys website widget wordpress shopify oauth app keys instagram facebook social accounts",
      },
      {
        to: "/monitoring",
        label: "Alerts & health",
        desc: "Is WhatsApp working?",
        icon: Activity,
        keywords: "monitoring alerts webhooks health logs errors status",
      },
      {
        to: "/settings",
        label: "Settings",
        desc: "Account and company preferences",
        icon: Settings,
        keywords: "settings billing team security data profile account subscription",
      },
    ],
  },
];

/** Platform staff only. The layout adds it for super admins; it is not role-filtered. */
export const MANAGER_SECTION: NavSection = {
  id: "platform",
  title: "Platform",
  items: [
    {
      to: "/companies",
      label: "Companies",
      desc: "Clients, subscriptions and access",
      icon: Building2,
      keywords:
        "tenants workspaces clients organizations subscriptions billing payments paid renew suspend plans",
    },
    {
      to: "/companies/errors",
      label: "Errors & issues",
      desc: "What customers are hitting",
      icon: Bug,
      keywords: "errors issues bugs incidents failures",
    },
    {
      to: "/companies/email-settings",
      label: "Platform email",
      desc: "System SMTP and IMAP settings",
      icon: Mail,
      keywords: "platform email smtp imap system mail sender outgoing incoming settings",
    },
  ],
};

/**
 * Screens that exist and are linked from inside the app but are not menu
 * entries. /content ("Saved drafts") is opened from Website & SEO.
 */
export const UNLISTED_ROUTES: readonly string[] = ["/content"];

const MENU_ITEMS: readonly NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);
const PLATFORM_ITEMS: readonly NavItem[] = MANAGER_SECTION.items;

/**
 * The tabs of the phone's bottom bar. They are the menu's own entries, so they
 * carry the menu's names and icons; the bar has no names of its own.
 */
export const MOBILE_BAR_ROUTES = ["/dashboard", "/inbox", "/contacts", "/social"] as const;
export const MOBILE_BAR_ITEMS: readonly NavItem[] = MOBILE_BAR_ROUTES.map((to) => {
  const item = MENU_ITEMS.find((entry) => entry.to === to);
  if (!item) throw new Error(`${to} is on the phone bar but not in the menu`);
  return item;
});

/**
 * What search (Ctrl K) can offer as a page: every entry in the sidebar, the
 * platform pages included. Ask `paletteFor(role)` for what one person may see.
 */
export const PALETTE_PAGES: readonly NavItem[] = [...MENU_ITEMS, ...PLATFORM_ITEMS];

/*
 * One rule, four surfaces. The sidebar, the phone bar, search and "+ Create"
 * each ask `canOpen(role, route)` (lib/permissions.ts) through these, so a role
 * that cannot open a screen is offered it nowhere, and one that can is offered it
 * everywhere it belongs. Pass the role as loaded; an unknown or not-yet-loaded
 * role (null) is offered only Home.
 */

/** The sections the sidebar and the phone drawer show this role, without empty ones. */
export function navSectionsFor(role: string | null | undefined): readonly NavSection[] {
  return [...NAV_SECTIONS, MANAGER_SECTION]
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => canOpen(role, item.to)),
    }))
    .filter((section) => section.items.length > 0);
}

/** The pages search offers this role. */
export function paletteFor(role: string | null | undefined): readonly NavItem[] {
  return PALETTE_PAGES.filter((page) => canOpen(role, page.to));
}

/** The tabs the phone's bottom bar shows this role ("More" is always there). */
export function mobileBarFor(role: string | null | undefined): readonly NavItem[] {
  return MOBILE_BAR_ITEMS.filter((item) => canOpen(role, item.to));
}

/**
 * The "+ Create" actions this role may use. `index` is the action's place in
 * QUICK_CREATE_ACTIONS, which is also its translation key, so filtering never
 * shifts a label onto the wrong action.
 */
export function quickCreateFor(
  role: string | null | undefined,
): readonly { action: QuickCreateAction; index: number }[] {
  return QUICK_CREATE_ACTIONS.map((action, index) => ({ action, index })).filter(({ action }) =>
    canOpen(role, action.to),
  );
}

export type QuickCreateAction = {
  label: string;
  desc: string;
  to: string;
  /** Opens the screen on a particular tab, e.g. the writer on Social posts. */
  search?: Record<string, string>;
  icon: LucideIcon;
};

/**
 * The "+ Create" menu. Every entry lands on a screen that works. The position
 * of an action is its translation key (`quickCreate.action.<n>.*`), so add to
 * the end rather than reordering.
 */
export const QUICK_CREATE_ACTIONS: readonly QuickCreateAction[] = [
  { label: "Lead", desc: "Capture or import leads", to: "/marketing", icon: UserPlus },
  { label: "Contact", desc: "Add a person to the CRM", to: "/contacts", icon: UserPlus },
  { label: "Message", desc: "Open a conversation", to: "/inbox", icon: MessageSquare },
  { label: "Campaign", desc: "Plan an email campaign", to: "/marketing", icon: Mail },
  {
    label: "Social post",
    desc: "Write and plan a post",
    to: "/social",
    search: { tab: "write" },
    icon: Megaphone,
  },
  {
    label: "SEO article",
    desc: "Write an article for Google",
    to: "/seo-blog/studio",
    icon: Sparkles,
  },
  { label: "Product", desc: "Add to your catalog", to: "/catalog", icon: Package },
  {
    label: "Content draft",
    desc: "Keep a draft post or article",
    to: "/content",
    icon: FileText,
  },
];
