// Every screen's text, combined. Adding a screen: write src/lib/i18n/screens/<name>.ts
// and list it here. The compiler then enforces that it carries every language.
import { TRANSLATED_LANGUAGES } from "./define";
import advisor from "./screens/advisor";
import aiKeysCard from "./screens/ai-keys-card";
import auth from "./screens/auth";
import campaignPlanner from "./screens/campaign-planner";
import catalog from "./screens/catalog";
import channelReportDialog from "./screens/channel-report-dialog";
import chatbot from "./screens/chatbot";
import commandPalette from "./screens/command-palette";
import common from "./screens/common";
import companiesEmails from "./screens/companies-emails";
import companiesErrors from "./screens/companies-errors";
import companiesIndex from "./screens/companies-index";
import companiesOrgId from "./screens/companies-org-id";
import companyMembers from "./screens/company-members";
import connectBusiness from "./screens/connect-business";
import connectionOutcome from "./screens/connection-outcome";
import connectionWizard from "./screens/connection-wizard";
import contactCard from "./screens/contact-card";
import contacts from "./screens/contacts";
import content from "./screens/content";
import credentialsStep from "./screens/credentials-step";
import dashboard from "./screens/dashboard";
import features from "./screens/features";
import followUpCard from "./screens/follow-up-card";
import healthReportDialog from "./screens/health-report-dialog";
import home from "./screens/home";
import inbox from "./screens/inbox";
import inboxPreview from "./screens/inbox-preview";
import incidentsCard from "./screens/incidents-card";
import integrationLogs from "./screens/integration-logs";
import integrationSettings from "./screens/integration-settings";
import integrationsAuditFixed from "./screens/integrations-audit-fixed";
import integrationsV2 from "./screens/integrations-v2";
import invoiceBrandingCard from "./screens/invoice-branding-card";
import invoiceBuilder from "./screens/invoice-builder";
import kpiTargetsCard from "./screens/kpi-targets-card";
import manageSubscriptionDialog from "./screens/manage-subscription-dialog";
import marketing from "./screens/marketing";
import marketingShell from "./screens/marketing-shell";
import monitoring from "./screens/monitoring";
import nav from "./screens/nav";
import onboardingModal from "./screens/onboarding-modal";
import payToken from "./screens/pay-token";
import paymentTestModeBanner from "./screens/payment-test-mode-banner";
import platformAppsCard from "./screens/platform-apps-card";
import pricing from "./screens/pricing";
import quickCreate from "./screens/quick-create";
import regionCard from "./screens/region-card";
import resetPassword from "./screens/reset-password";
import root from "./screens/root";
import sales from "./screens/sales";
import seoBlogIndex from "./screens/seo-blog-index";
import seoBlogStudio from "./screens/seo-blog-studio";
import settings from "./screens/settings";
import settingsEmail from "./screens/settings-email";
import settingsIndex from "./screens/settings-index";
import shell from "./screens/shell";
import social from "./screens/social";
import socialInbox from "./screens/social-inbox";
import stickyCta from "./screens/sticky-cta";
import verifyToken from "./screens/verify-token";
import websiteKnowledgeCard from "./screens/website-knowledge-card";
import whatsappBusinessApi from "./screens/whatsapp-business-api";
import widgetDemo from "./screens/widget-demo";
import wordPressSitesCard from "./screens/word-press-sites-card";

const SCREENS = [
  advisor,
  aiKeysCard,
  auth,
  campaignPlanner,
  catalog,
  channelReportDialog,
  chatbot,
  commandPalette,
  common,
  companiesEmails,
  companiesErrors,
  companiesIndex,
  companiesOrgId,
  companyMembers,
  connectBusiness,
  connectionOutcome,
  connectionWizard,
  contactCard,
  contacts,
  content,
  credentialsStep,
  dashboard,
  features,
  followUpCard,
  healthReportDialog,
  home,
  inbox,
  inboxPreview,
  incidentsCard,
  integrationLogs,
  integrationSettings,
  integrationsAuditFixed,
  integrationsV2,
  invoiceBrandingCard,
  invoiceBuilder,
  kpiTargetsCard,
  manageSubscriptionDialog,
  marketing,
  marketingShell,
  monitoring,
  nav,
  onboardingModal,
  payToken,
  paymentTestModeBanner,
  platformAppsCard,
  pricing,
  quickCreate,
  regionCard,
  resetPassword,
  root,
  sales,
  seoBlogIndex,
  seoBlogStudio,
  settings,
  settingsEmail,
  settingsIndex,
  shell,
  social,
  socialInbox,
  stickyCta,
  verifyToken,
  websiteKnowledgeCard,
  whatsappBusinessApi,
  widgetDemo,
  wordPressSitesCard,
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
