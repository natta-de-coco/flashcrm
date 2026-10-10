// Which outbound-email providers a company may choose. One list, read by the
// settings screen and by the server function that saves the choice; the words
// the sender answers with for a provider it has no code for come from here too.
// tests/email-providers.test.mjs holds the list against the sender itself, so a
// provider cannot be added to one without the other.
//
// They had drifted: the screen offered "AWS SES" and "SMTP relay", the server
// accepted them, and the sender had no code for either. A company that picked
// one had every email fail, and because it had saved its own key the platform's
// mailer was not used instead. Browser-safe and pure.

/** Providers there is a sender for in src/lib/email-dispatch.server.ts. */
export const SENDING_PROVIDERS = ["resend", "postmark", "mailgun", "sendgrid"] as const;
export type SendingProvider = (typeof SENDING_PROVIDERS)[number];

/** What a company may choose: one of those, or the platform's own mailer. */
export const SELECTABLE_PROVIDERS = ["platform", ...SENDING_PROVIDERS] as const;
export type SelectableProvider = (typeof SELECTABLE_PROVIDERS)[number];

export function isSendingProvider(value: unknown): value is SendingProvider {
  return (SENDING_PROVIDERS as readonly unknown[]).includes(value);
}

/**
 * False for the two providers that were offered and never worked ("ses",
 * "smtp_relay") — a company may still have one saved — and for anything else
 * this version does not know.
 */
export function isSelectableProvider(value: unknown): value is SelectableProvider {
  return (SELECTABLE_PROVIDERS as readonly unknown[]).includes(value);
}

const NAMES = new Map<string, string>([
  ["platform", "Platform default"],
  ["resend", "Resend"],
  ["postmark", "Postmark"],
  ["mailgun", "Mailgun"],
  ["sendgrid", "SendGrid"],
  ["ses", "AWS SES"],
  ["smtp_relay", "SMTP relay"],
]);

/** The name a person knows a provider by, for a saved value such as "ses". */
export function providerName(provider: string): string {
  return NAMES.get(provider) ?? provider;
}

/**
 * What the sender answers for a provider it has no code for. Written for the
 * company admin who reads it under "Last test" and in the delivery log.
 */
export function unsupportedProviderError(provider: string): string {
  return `${providerName(provider)} is not supported, so this email was not sent. Choose Resend, Postmark, Mailgun or SendGrid in Settings → Email.`;
}
