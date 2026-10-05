// Every screen's text, combined. Adding a screen: write src/lib/i18n/screens/<name>.ts
// and list it here. The compiler then enforces that it carries every language.
import { TRANSLATED_LANGUAGES } from "./define";
import advisor from "./screens/advisor";
import auth from "./screens/auth";
import campaignPlanner from "./screens/campaign-planner";
import catalog from "./screens/catalog";
import channelReportDialog from "./screens/channel-report-dialog";
import chatbot from "./screens/chatbot";
import commandPalette from "./screens/command-palette";
import common from "./screens/common";
import contactCard from "./screens/contact-card";
import contacts from "./screens/contacts";
import content from "./screens/content";
import dashboard from "./screens/dashboard";
import followUpCard from "./screens/follow-up-card";
import inbox from "./screens/inbox";
import incidentsCard from "./screens/incidents-card";
import invoiceBrandingCard from "./screens/invoice-branding-card";
import invoiceBuilder from "./screens/invoice-builder";
import kpiTargetsCard from "./screens/kpi-targets-card";
import marketing from "./screens/marketing";
import monitoring from "./screens/monitoring";
import nav from "./screens/nav";
import onboardingModal from "./screens/onboarding-modal";
import paymentTestModeBanner from "./screens/payment-test-mode-banner";
import quickCreate from "./screens/quick-create";
import regionCard from "./screens/region-card";
import sales from "./screens/sales";
import seoBlogIndex from "./screens/seo-blog-index";
import seoBlogStudio from "./screens/seo-blog-studio";
import settings from "./screens/settings";
import settingsEmail from "./screens/settings-email";
import settingsIndex from "./screens/settings-index";
import shell from "./screens/shell";
import social from "./screens/social";
import socialInbox from "./screens/social-inbox";

const SCREENS = [
  advisor,
  auth,
  campaignPlanner,
  catalog,
  channelReportDialog,
  chatbot,
  commandPalette,
  common,
  contactCard,
  contacts,
  content,
  dashboard,
  followUpCard,
  inbox,
  incidentsCard,
  invoiceBrandingCard,
  invoiceBuilder,
  kpiTargetsCard,
  marketing,
  monitoring,
  nav,
  onboardingModal,
  paymentTestModeBanner,
  quickCreate,
  regionCard,
  sales,
  seoBlogIndex,
  seoBlogStudio,
  settings,
  settingsEmail,
  settingsIndex,
  shell,
  social,
  socialInbox,
] as const;

type KeysOf<T> = T extends unknown ? keyof T : never;

/** Every key any screen defines. */
export type MessageKey = KeysOf<(typeof SCREENS)[number]["en"]> & string;

/** English: the source every other language is checked against. */
export const en = Object.assign({}, ...SCREENS.map((s) => s.en)) as Record<MessageKey, string>;

/** Each language's text, keyed by language code. */
export const MESSAGES: Record<string, Partial<Record<MessageKey, string>>> = {
  en,
  ...Object.fromEntries(
    TRANSLATED_LANGUAGES.map((language) => [
      language,
      Object.assign({}, ...SCREENS.map((s) => s[language])),
    ]),
  ),
};

/** For tests: the screens as declared, so keys can be checked for collisions. */
export const SCREEN_LIST = SCREENS;
