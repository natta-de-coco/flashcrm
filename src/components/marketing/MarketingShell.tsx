import { FlasWordmark } from "@/components/FlashLogoBadge";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { HomepageChatWidget } from "@/components/marketing/HomepageChatWidget";

/**
 * Header and footer shared by every public marketing page.
 *
 * The landing page keeps its own copy because its header sits over an animated
 * hero and needs different treatment; everything else — blog index, articles —
 * renders inside this so the site does not drift apart as pages are added.
 */
export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex min-w-0 items-center gap-3">
            <FlasWordmark className="h-16 max-w-56 sm:h-[4.5rem] sm:max-w-72" />
            <span className="hidden border-l border-border pl-3 text-xs font-medium leading-tight text-muted-foreground sm:block">
              CRM by
              <br />
              Mobi Digital Solutions
            </span>
          </Link>
          <nav className="flex items-center gap-4">
            <Link
              to="/features"
              className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline"
            >
              Features
            </Link>
            <Link
              to="/pricing"
              className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline"
            >
              Pricing
            </Link>
            <Link
              to="/blog"
              className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground sm:inline"
            >
              Guides
            </Link>
            <Button asChild size="sm">
              <Link to="/auth">Open app</Link>
            </Button>
          </nav>
        </div>
      </header>

      <HomepageChatWidget />
      {children}

      <footer className="mt-20 border-t py-8 text-center text-xs text-muted-foreground">
        <p className="font-medium text-foreground">
          Flas CRM — a product of Mobi Digital Solutions
        </p>
        <p className="mt-3 flex flex-wrap items-center justify-center gap-3">
          <Link to="/" className="underline">
            Home
          </Link>
          <Link to="/features" className="underline">
            Features
          </Link>
          <Link to="/pricing" className="underline">
            Pricing
          </Link>
          <Link to="/whatsapp-business-api" className="underline">
            WhatsApp API
          </Link>
          <Link to="/blog" className="underline">
            Guides
          </Link>
          <Link to="/privacy" className="underline">
            Privacy Policy
          </Link>
          <Link to="/terms" className="underline">
            Terms of Service
          </Link>
          <a href="mailto:info@mobidigisol.com" className="underline">
            Contact
          </a>
        </p>
      </footer>
    </div>
  );
}
