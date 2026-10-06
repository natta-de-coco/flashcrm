import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { useI18n } from "@/hooks/useI18n";

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
  const { t, tr } = useI18n();
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
          <span className="text-lg font-bold tracking-tight">
            {t("widgetDemo.northlineTrading")}
          </span>
          <nav className="hidden gap-6 text-sm text-slate-500 sm:flex">
            <span>{t("widgetDemo.products")}</span>
            <span>{t("widgetDemo.services")}</span>
            <span>{t("widgetDemo.about")}</span>
            <span>{t("widgetDemo.contact")}</span>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-16">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600">
          {t("widgetDemo.widgetPreview")}
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
          {t("widgetDemo.thisIsAStandIn")}
        </h1>
        <p className="mt-4 max-w-2xl text-slate-600">
          {tr("widgetDemo.theChatLauncherInThe", {
            code: (
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-sm">{origin}/widget.js</code>
            ),
          })}
        </p>

        {!siteKey ? (
          <div className="mt-8 rounded-xl border border-amber-300 bg-amber-50 p-5">
            <p className="font-semibold">{t("widgetDemo.noSiteKeySupplied")}</p>
            <p className="mt-1.5 text-sm text-slate-700">
              {tr("widgetDemo.theWidgetNeedsASite", {
                strong: <strong>{t("widgetDemo.integrationsWebsiteChatWidgetPreview")}</strong>,
                strong2: <strong>{t("widgetDemo.addYourWebsite")}</strong>,
              })}
            </p>
          </div>
        ) : (
          <div className="mt-8 rounded-xl border border-emerald-300 bg-emerald-50 p-5">
            <p className="font-semibold">{t("widgetDemo.liveWidgetLoaded")}</p>
            <p className="mt-1.5 text-sm text-slate-700">
              {t("widgetDemo.messagesYouSendHereAre")}
            </p>
          </div>
        )}

        <h2 className="mt-12 text-lg font-semibold">{t("widgetDemo.whatTheVisitorIsAsked")}</h2>
        <ul className="mt-3 grid gap-2 text-sm text-slate-600">
          <li>{t("widgetDemo.nameAndWhatsappNumberBefore")}</li>
          <li>{t("widgetDemo.emailOptional")}</li>
          <li>{t("widgetDemo.marketingConsentAsASeparate")}</li>
          <li>{t("widgetDemo.aLinkToYourPrivacy")}</li>
        </ul>

        <div className="mt-16 grid gap-4 text-sm text-slate-400">
          <div className="h-24 rounded-lg bg-slate-50" />
          <div className="h-24 rounded-lg bg-slate-50" />
          <p className="text-center">{t("widgetDemo.fillerContentSoTheLauncher")}</p>
        </div>
      </main>
    </div>
  );
}
