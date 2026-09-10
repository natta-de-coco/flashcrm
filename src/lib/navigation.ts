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
 * `keywords` exists because a label is not what a customer types. Nobody
 * searches "Quotes & Invoices"; they search "invoice", "bill", "receipt" or
 * "VAT". These are matched but never displayed.
 */
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
  Package,
  Plug,
  Receipt,
  Share2,
  Settings,
  Sparkles,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  to: string;
  label: string;
  desc: string;
  icon: LucideIcon;
  /** Extra search terms. Matched, never rendered. */
  keywords?: string;
};

export type NavSection = {
  title: string;
  items: readonly NavItem[];
};

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    title: "Main",
    items: [
      {
        to: "/dashboard",
        label: "Home",
        desc: "Live pulse of every channel",
        icon: LayoutDashboard,
        keywords: "dashboard overview home start",
      },
      {
        to: "/inbox",
        label: "Inbox",
        desc: "WhatsApp & website chats",
        icon: Inbox,
        keywords: "messages chat conversations whatsapp dm",
      },
      {
        to: "/contacts",
        label: "Contacts",
        desc: "People & pipeline",
        icon: Users,
        keywords: "people customers leads pipeline crm deals",
      },
      {
        to: "/marketing",
        label: "Leads & Marketing",
        desc: "Capture, consent, campaigns",
        icon: Mail,
        keywords: "campaigns email capture forms consent newsletter",
      },
      {
        to: "/social",
        label: "Social Hub",
        desc: "IG, FB, YouTube, X & more",
        icon: Megaphone,
        keywords: "instagram facebook youtube twitter x tiktok linkedin posts accounts connect",
      },
      {
        to: "/channels",
        label: "Social Channels",
        desc: "Connect & manage channels",
        icon: Share2,
        keywords: "add channel connect youtube facebook instagram reconnect permissions accounts",
      },
      {
        to: "/content",
        label: "Content & SEO",
        desc: "Posts & articles",
        icon: FileText,
        keywords: "blog articles posts drafts publish",
      },
      {
        to: "/seo-blog",
        label: "SEO Studio",
        desc: "Image-to-post AI studio",
        icon: Sparkles,
        keywords: "seo blog article writer ai image wordpress publish",
      },
    ],
  },
  {
    title: "Business",
    items: [
      {
        to: "/advisor",
        label: "Business Advisor",
        desc: "Expert AI growth guidance",
        icon: Briefcase,
        keywords: "advice growth strategy ai consultant",
      },
      {
        to: "/campaign-planner",
        label: "Campaign Planner",
        desc: "AI audience & channel targeting",
        icon: Target,
        keywords: "campaign plan audience targeting ads channels",
      },
      {
        to: "/sales",
        label: "Quotes & Invoices",
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
        keywords: "products catalog items sku price inventory services",
      },
      {
        to: "/chatbot",
        label: "Chatbot",
        desc: "AI auto-replies",
        icon: Bot,
        keywords: "bot auto reply automation ai answers",
      },
    ],
  },
  {
    title: "System",
    items: [
      {
        to: "/monitoring",
        label: "Monitoring",
        desc: "Alerts, webhooks & Meta health",
        icon: Activity,
        keywords: "alerts webhooks health logs errors status",
      },
      {
        to: "/connect",
        label: "Integrations",
        desc: "WhatsApp, social, website & keys",
        icon: Plug,
        keywords:
          "integrations connect setup whatsapp api keys website widget wordpress shopify oauth app keys",
      },
      {
        to: "/settings",
        label: "Settings",
        desc: "Billing, team, security & data",
        icon: Settings,
        keywords: "settings billing team security data profile account subscription",
      },
    ],
  },
];

export const MANAGER_SECTION: NavSection = {
  title: "Manager",
  items: [
    {
      to: "/companies",
      label: "Companies",
      desc: "All client workspaces",
      icon: Building2,
      keywords: "tenants workspaces clients organizations",
    },
    {
      to: "/companies/errors",
      label: "Errors & issues",
      desc: "What customers are hitting",
      icon: Bug,
      keywords: "errors issues bugs incidents failures",
    },
  ],
};
