// The interface in English. This file is the source of truth: every key used
// anywhere is defined here, and every other language is checked against it.
// A key another language has not translated yet shows in English, never as a
// raw key.
//
// {name} marks a value filled in at runtime.

export const en = {
  // ── Language switcher ──
  "language.label": "Language",
  "language.choose": "Change language",

  // ── App shell ──
  "shell.search": "Search Flas…",
  "shell.searchLabel": "Search Flas",
  "shell.openMenu": "Open menu",
  "shell.signOut": "Sign out",
  "shell.resizeSidebar": "Resize sidebar",
  "shell.loading": "Loading your workspace…",
  "shell.primaryNav": "Primary",
  "shell.more": "More",

  // ── Navigation sections ──
  "nav.section.main": "Main",
  "nav.section.business": "Business",
  "nav.section.system": "System",
  "nav.section.manager": "Manager",

  // ── Navigation items ──
  "nav.dashboard.label": "Home",
  "nav.dashboard.desc": "Live pulse of every channel",
  "nav.inbox.label": "Inbox",
  "nav.inbox.desc": "WhatsApp & website chats",
  "nav.contacts.label": "Contacts",
  "nav.contacts.desc": "People & pipeline",
  "nav.marketing.label": "Leads & Marketing",
  "nav.marketing.desc": "Capture, consent, campaigns",
  "nav.social.label": "Social Hub",
  "nav.social.desc": "IG, FB, YouTube, X & more",
  "nav.content.label": "Content & SEO",
  "nav.content.desc": "Posts & articles",
  "nav.seo-blog.label": "SEO Studio",
  "nav.seo-blog.desc": "Image-to-post AI studio",
  "nav.advisor.label": "Business Advisor",
  "nav.advisor.desc": "Expert AI growth guidance",
  "nav.campaign-planner.label": "Campaign Planner",
  "nav.campaign-planner.desc": "AI audience & channel targeting",
  "nav.sales.label": "Quotes & Invoices",
  "nav.sales.desc": "Send PDFs, get paid on WhatsApp",
  "nav.catalog.label": "Products",
  "nav.catalog.desc": "What you sell",
  "nav.chatbot.label": "Chatbot",
  "nav.chatbot.desc": "AI auto-replies",
  "nav.monitoring.label": "Monitoring",
  "nav.monitoring.desc": "Alerts, webhooks & Meta health",
  "nav.connect.label": "Integrations",
  "nav.connect.desc": "WhatsApp, social, website & keys",
  "nav.settings.label": "Settings",
  "nav.settings.desc": "Billing, team, security & data",
  "nav.companies.label": "Companies",
  "nav.companies.desc": "Clients, subscriptions and access",
  "nav.companies.errors.label": "Errors & issues",
  "nav.companies.errors.desc": "What customers are hitting",

  // ── Mobile bottom bar (short) ──
  "bottomNav.dashboard": "Home",
  "bottomNav.inbox": "Inbox",
  "bottomNav.marketing": "Leads",
  "bottomNav.social": "Social",

  // ── Sign in ──
  "auth.heroTitle": "Every WhatsApp conversation, in one shared inbox.",
  "auth.heroBody":
    "Live WhatsApp monitoring, an AI chatbot that answers instantly, website chat, and a lead pipeline your team actually keeps up to date.",
  "auth.firstAccountAdmin": "The first account created becomes the workspace admin.",
  "auth.tab.signIn": "Sign in",
  "auth.tab.signUp": "Create account",
  "auth.workEmail": "Work email",
  "auth.password": "Password",
  "auth.fullName": "Full name",
  "auth.signIn": "Sign in",
  "auth.signingIn": "Signing in…",
  "auth.forgotPassword": "Forgot your password?",
  "auth.sendReset": "Send password reset link",
  "auth.sendingReset": "Sending reset link…",
  "auth.backToSignIn": "Back to sign in",
  "auth.back": "Back",
  "auth.mfaCode": "Two-factor code",
  "auth.mfaHint": "Enter the 6-digit code from your authenticator app.",
  "auth.mfaVerify": "Verify and sign in",
  "auth.createAccount": "Create account",
  "auth.creatingAccount": "Creating account…",
  "auth.checkEmail": "Check your email",
  "auth.verificationSentTo": "We sent a verification link to {email}.",
  "auth.resend": "Resend verification email",
  "auth.resendIn": "Resend available in {seconds}s",
  "auth.resendLimit": "Resend limit reached",
  "auth.differentEmail": "Use a different email",
  "auth.agreePrefix": "By continuing you agree to our",
  "auth.terms": "Terms",
  "auth.and": "and",
  "auth.privacy": "Privacy Policy",
  "auth.enterEmailFirst": "Enter your email address first.",
  "auth.resetSent": "If an account exists, a password reset link has been sent.",
  "auth.verificationResent": "A new verification email has been sent.",
  "auth.resendFailed": "Could not resend.",
  "auth.checkInboxFor": "Check {email} for your Flas verification email.",
} as const;

export type MessageKey = keyof typeof en;
