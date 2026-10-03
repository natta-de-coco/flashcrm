import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Flas CRM" },
      {
        name: "description",
        content:
          "How Flas CRM collects, stores and protects WhatsApp conversations, leads and customer data, and how to exercise your data rights.",
      },
      { property: "og:title", content: "Privacy Policy — Flas CRM" },
      {
        property: "og:description",
        content:
          "How Flas CRM handles WhatsApp conversations, leads and customer data, plus your export and deletion rights.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <Link to="/" className="text-sm text-muted-foreground underline">
        ← Back to Flas CRM
      </Link>
      <h1 className="mt-6 text-3xl font-bold">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: 26 August 2026</p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed">
        <section className="rounded-xl border bg-muted/30 p-5">
          <h2 className="text-lg font-semibold">Security &amp; trust at a glance</h2>
          <p className="mt-2 text-muted-foreground">
            Your workspace is separated from other companies at the data layer. Access to customer
            records is limited to signed-in members of that workspace, and sensitive connection
            credentials are handled by server-side operations rather than returned to the browser.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>
              Workspace-level access controls protect contacts, chats, invoices and integrations.
            </li>
            <li>
              Important actions such as consent, imports, exports and message actions are recorded
              in an audit log.
            </li>
            <li>
              Incoming WhatsApp and supported plugin webhooks are verified before they are
              processed.
            </li>
            <li>Admins can enable authenticator-app two-factor authentication.</li>
            <li>
              Workspace admins can download their data or submit a deletion request from Settings.
            </li>
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            We do not claim a security certification unless one has been independently completed and
            published.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">1. Who we are</h2>
          <p className="mt-2 text-muted-foreground">
            Flas CRM is a WhatsApp customer messaging and marketing platform sold to businesses on a
            monthly subscription. Each customer company (a "workspace") is the data controller for
            the contacts and conversations it stores; Flas CRM acts as the processor on its behalf.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">2. Data we process</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>Account data: name, email, workspace name, role and billing status.</li>
            <li>
              Contact and lead data your workspace collects: name, phone number, email, company,
              tags, pipeline stage, consent status and consent timestamp.
            </li>
            <li>
              Conversation data: WhatsApp and website chat messages, delivery/read status,
              attachments and any AI-generated translations or suggested replies.
            </li>
            <li>
              Operational data: audit logs, webhook delivery logs, analytics counters and error
              reports used to keep the service reliable and compliant.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold">3. How we use it</h2>
          <p className="mt-2 text-muted-foreground">
            To deliver and secure the service: route and store messages, apply consent and messaging
            safety rules, generate analytics and AI assistance, prevent abuse, handle billing and
            provide support. We never sell personal data. AI features only send the information
            needed for the requested workspace feature to the configured model provider, such as a
            draft, translation or suggested reply.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">4. Consent and marketing rules</h2>
          <p className="mt-2 text-muted-foreground">
            Marketing messages may only be sent to contacts who have opted in. Flas CRM records the
            consent flag and timestamp for every lead and blocks campaigns to contacts without
            consent. Workspaces must comply with WhatsApp Business Policy, GDPR/ePrivacy, CAN-SPAM
            and local marketing regulations. Every recipient can opt out at any time and the opt-out
            is honoured immediately.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">5. Sub-processors</h2>
          <p className="mt-2 text-muted-foreground">
            We rely on Meta (WhatsApp Cloud API) for message delivery, a managed cloud database and
            hosting provider for storage and compute, a payment provider for subscriptions, and AI
            model providers for assistant features. Access is limited to what each service needs.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">6. Retention</h2>
          <p className="mt-2 text-muted-foreground">
            Workspace data is retained while the subscription is active. After cancellation, data is
            kept for 30 days and then deleted, unless a shorter deletion request is submitted.
            Append-only audit logs may be retained longer where law requires it.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">7. Security</h2>
          <p className="mt-2 text-muted-foreground">
            Data is isolated per workspace with row-level security. Sensitive integration
            credentials are restricted to server-side operations and are not returned through normal
            browser data requests. Incoming WhatsApp and supported plugin webhooks are
            signature-verified, and administrator accounts can enable two-step authentication. All
            traffic is encrypted in transit.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">8. Cookies</h2>
          <p className="mt-2 text-muted-foreground">
            We use strictly necessary cookies and local storage to keep you signed in and remember
            interface preferences. We do not run third-party advertising trackers in the app.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">9. Your rights</h2>
          <p className="mt-2 text-muted-foreground">
            You can export all workspace data as JSON and request account or workspace deletion from
            Settings → Data &amp; privacy. You may also request access, correction, restriction or
            portability by contacting us. Deletion requests are processed within 30 days.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">10. Contact</h2>
          <p className="mt-2 text-muted-foreground">
            Questions about this policy or your data: reach out to your Flas CRM account manager or
            the support address shown in your workspace billing details.
          </p>
        </section>
      </div>
    </main>
  );
}
