import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";

/**
 * Widget preview.
 *
 * "Preview the widget" in Integrations pointed here and the route did not
 * exist, so it returned a 404 — the one link whose entire job was to prove the
 * widget works.
 *
 * It renders a plain mock business page and loads the real widget.js against a
 * real site key, so what you see is exactly what a visitor to your own site
 * gets: the same identity form, the same consent box, the same endpoint. A
 * screenshot of a widget proves nothing; this runs it.
 */
export const Route = createFileRoute("/widget-demo")({
  validateSearch: z.object({ siteKey: z.string().max(120).optional() }),
  head: () => ({
    meta: [
      { title: "Widget preview — Flas CRM" },
      // A mock page must never be indexed as though it were a real business.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: WidgetDemo,
});

function WidgetDemo() {
  const { siteKey } = Route.useSearch();
  const [origin, setOrigin] = useState("");

  useEffect(() => setOrigin(window.location.origin), []);

  useEffect(() => {
    if (!siteKey) return;
    const script = document.createElement("script");
    script.src = "/widget.js";
    script.async = true;
    script.setAttribute("data-site-key", siteKey);
    document.body.appendChild(script);
    return () => {
      script.remove();
      document.querySelector(".flasw")?.remove();
    };
  }, [siteKey]);

  return (
    <div className="min-h-screen bg-white text-slate-800">
      {/* Deliberately plain and unbranded: this stands in for the customer's
          own website, so it should not look like part of Flas. */}
      <header className="border-b">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <span className="text-lg font-bold tracking-tight">Northline Trading</span>
          <nav className="hidden gap-6 text-sm text-slate-500 sm:flex">
            <span>Products</span>
            <span>Services</span>
            <span>About</span>
            <span>Contact</span>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-16">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600">
          Widget preview
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
          This is a stand-in for your website
        </h1>
        <p className="mt-4 max-w-2xl text-slate-600">
          The chat launcher in the bottom-right corner is the real widget, loaded from{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-sm">{origin}/widget.js</code>.
          Open it and you will see exactly what a visitor sees.
        </p>

        {!siteKey ? (
          <div className="mt-8 rounded-xl border border-amber-300 bg-amber-50 p-5">
            <p className="font-semibold">No site key supplied</p>
            <p className="mt-1.5 text-sm text-slate-700">
              The widget needs a site key to know which workspace a conversation belongs to, so
              nothing is loaded on this page. Open this preview from{" "}
              <strong>Integrations → Website chat widget → Preview the widget</strong>, which passes
              your key automatically. If you have no website added yet, create one first under{" "}
              <strong>Add your website</strong>.
            </p>
          </div>
        ) : (
          <div className="mt-8 rounded-xl border border-emerald-300 bg-emerald-50 p-5">
            <p className="font-semibold">Live widget loaded</p>
            <p className="mt-1.5 text-sm text-slate-700">
              Messages you send here are real: they arrive in your Flas inbox and create a contact,
              exactly as a visitor's would. Use a number you can recognise so it is easy to delete
              afterwards.
            </p>
          </div>
        )}

        <h2 className="mt-12 text-lg font-semibold">What the visitor is asked for</h2>
        <ul className="mt-3 grid gap-2 text-sm text-slate-600">
          <li>• Name and WhatsApp number, before the first message — so a lead exists even if they never type again.</li>
          <li>• Email, optional.</li>
          <li>
            • Marketing consent as a separate unticked box. Asking a question is not agreeing to
            receive campaigns, and treating those as the same thing is what earns blocks.
          </li>
          <li>• A link to your privacy notice, shown before anything is submitted.</li>
        </ul>

        <div className="mt-16 grid gap-4 text-sm text-slate-400">
          <div className="h-24 rounded-lg bg-slate-50" />
          <div className="h-24 rounded-lg bg-slate-50" />
          <p className="text-center">Filler content, so the launcher has a page to sit over.</p>
        </div>
      </main>
    </div>
  );
}
