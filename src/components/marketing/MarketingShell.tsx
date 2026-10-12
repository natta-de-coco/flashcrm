import { FlasWordmark } from "@/components/FlashLogoBadge";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { HomepageChatWidget } from "@/components/marketing/HomepageChatWidget";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useI18n } from "@/hooks/useI18n";

/**
 * Header and footer shared by every public marketing page.
 *
 * The landing page keeps its own copy because its header sits over an animated
 * hero and needs different treatment; everything else — blog index, articles —
 * renders inside this so the site does not drift apart as pages are added.
 */
export function MarketingShell({ children }: { children: React.ReactNode }) {
  const { t, tr } = useI18n();
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex min-w-0 items-center gap-3">
            <FlasWordmark className="h-16 max-w-56 sm:h-[4.5rem] sm:max-w-72" />
            <span className="hidden border-s border-border ps-3 text-xs font-medium leading-tight text-muted-foreground sm:block">
              {tr("marketingShell.crmByMobiDigitalSolutions", { br: <br /> })}
            </span>
          </Link>
          <nav className="flex items-center gap-4">
            <Link
              to="/features"
              className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline"
            >
              {t("marketingShell.features")}
            </Link>
            <Link
              to="/pricing"
              className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline"
            >
              {t("marketingShell.pricing")}
            </Link>
            <Link
              to="/blog"
              className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline"
            >
              {t("marketingShell.guides")}
            </Link>
            <LanguageSwitcher compact />
            <Button asChild size="sm">
              <Link to="/auth">{t("marketingShell.openApp")}</Link>
            </Button>
          </nav>
        </div>
      </header>

      <HomepageChatWidget />
      {children}

      <footer className="mt-20 border-t py-8 text-center text-xs text-muted-foreground">
        <p className="font-medium text-foreground">{t("marketingShell.flasCrmAProductOf")}</p>
        <p className="mt-3 flex flex-wrap items-center justify-center gap-3">
          <Link to="/" className="underline">
            {t("marketingShell.home")}
          </Link>
          <Link to="/features" className="underline">
            {t("marketingShell.features")}
          </Link>
          <Link to="/pricing" className="underline">
            {t("marketingShell.pricing")}
          </Link>
          <Link to="/whatsapp-business-api" className="underline">
            {t("marketingShell.whatsappApi")}
          </Link>
          <Link to="/blog" className="underline">
            {t("marketingShell.guides")}
          </Link>
          <Link to="/privacy" className="underline">
            {t("marketingShell.privacyPolicy")}
          </Link>
          <Link to="/terms" className="underline">
            {t("marketingShell.termsOfService")}
          </Link>
          <a href="mailto:info@mobidigisol.com" className="underline">
            {t("marketingShell.contact")}
          </a>
        </p>
      </footer>
    </div>
  );
}
