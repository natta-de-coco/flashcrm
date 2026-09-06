import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — Flas CRM" },
      {
        name: "description",
        content:
          "Subscription terms for Flas CRM: free trial, $20/month billing, cancellation, acceptable use and WhatsApp messaging compliance.",
      },
      { property: "og:title", content: "Terms of Service — Flas CRM" },
      {
        property: "og:description",
        content:
          "Flas CRM subscription terms: trial, billing, cancellation, acceptable use and messaging compliance.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <Link to="/" className="text-sm text-muted-foreground underline">
        ← Back to Flas CRM
      </Link>
      <h1 className="mt-6 text-3xl font-bold">Terms of Service</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: 26 August 2026</p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold">1. Agreement</h2>
          <p className="mt-2 text-muted-foreground">
            By creating a Flas CRM workspace you agree to these terms. If you use Flas CRM on
            behalf of a company, you confirm you are authorised to bind that company.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">2. Subscription and trial</h2>
          <p className="mt-2 text-muted-foreground">
            Flas CRM has a list price of USD 30 per workspace per month. Under the current launch
            offer you pay USD 20 per month for your first six months, after which the standard rate
            applies. A yearly plan is available at USD 240 per year instead of USD 360. Every new
            workspace starts with a one-month free trial. Subscriptions renew automatically until
            cancelled. Prices exclude any local taxes that may apply.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">3. Cancellation and refunds</h2>
          <p className="mt-2 text-muted-foreground">
            You can cancel at any time from Settings → Billing. Access continues to the end of the
            paid period and no further charges are made. Partial months are not refunded except where
            required by law.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">4. Acceptable use</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>Only message people who have given you consent to be contacted.</li>
            <li>
              Do not send spam, scams, adult, gambling or other content prohibited by the WhatsApp
              Business and Commerce Policies.
            </li>
            <li>Do not scrape, resell or share other workspaces' data, or attempt to bypass tenant isolation.</li>
            <li>Do not use the API keys or plugin credentials outside your own websites.</li>
          </ul>
          <p className="mt-2 text-muted-foreground">
            We may suspend a workspace that breaches these rules or that puts a connected WhatsApp
            number's quality rating at risk.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">5. Your data</h2>
          <p className="mt-2 text-muted-foreground">
            You own the contacts, conversations and content in your workspace. You can export them at
            any time and request deletion from Settings → Data &amp; privacy. Our handling of personal
            data is described in the{" "}
            <Link to="/privacy" className="underline">
              privacy policy
            </Link>
            .
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">6. Third-party services</h2>
          <p className="mt-2 text-muted-foreground">
            Flas CRM connects to WhatsApp Cloud API, social platforms, WordPress/Shopify sites,
            payment providers and AI models. Their availability, policies and rate limits are outside
            our control and may affect features.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">7. AI features</h2>
          <p className="mt-2 text-muted-foreground">
            Flas AI drafts messages, briefs, replies and content. Output can be wrong or incomplete —
            review anything before it is sent or published. You remain responsible for all messages
            sent from your workspace.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">8. Availability and liability</h2>
          <p className="mt-2 text-muted-foreground">
            The service is provided on an "as is" basis without warranties of uninterrupted
            availability. To the maximum extent permitted by law, our aggregate liability is limited
            to the fees you paid in the 12 months before the claim.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">9. Changes</h2>
          <p className="mt-2 text-muted-foreground">
            We may update these terms; material changes will be announced in-app before they take
            effect. Continued use after the effective date means you accept the update.
          </p>
        </section>
      </div>
    </main>
  );
}
