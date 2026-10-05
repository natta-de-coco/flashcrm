import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { captureError, installTelemetry } from "../lib/telemetry";
import {
  installStaleChunkRecovery,
  isStaleChunkError,
  reloadForStaleChunk,
} from "../lib/stale-chunk";
import { AuthProvider } from "@/hooks/useAuth";
import { I18nProvider } from "@/hooks/useI18n";
import { PageLanguage } from "@/components/PageLanguage";
import { directionOf, isRtlUiLanguage } from "@/lib/i18n";
import { readUiLanguage } from "@/lib/i18n/read-language";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

// TanStack Router types a route error as `unknown` since 1.170.41: anything can
// be thrown, not only an Error. Normalize it before passing it to error helpers.
function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  const reportedError = error instanceof Error ? error : new Error(String(error));
  console.error(reportedError);
  const router = useRouter();
  const staleChunk = isStaleChunkError(reportedError);
  useEffect(() => {
    // A newer version was published while this tab was open: reload once to
    // fetch it. Only if that already happened moments ago is it reported, as
    // the file is then genuinely missing.
    if (staleChunk && reloadForStaleChunk()) return;
    reportLovableError(reportedError, { boundary: "tanstack_root_error_component" });
    captureError(reportedError, { kind: "error_boundary" });
  }, [reportedError, staleChunk]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              // Retrying in place would request the same missing file again.
              if (staleChunk) {
                window.location.reload();
                return;
              }
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // The interface language, from its cookie: on the server for the first
  // paint, in the browser on every navigation and after a switch.
  beforeLoad: () => ({ uiLanguage: readUiLanguage() }),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Flas CRM — WhatsApp Inbox & Chatbot" },
      {
        name: "description",
        content:
          "Flas CRM unifies WhatsApp conversations, website chat, contacts and an AI chatbot in one shared team inbox.",
      },
      { property: "og:title", content: "Flas CRM — WhatsApp Inbox & Chatbot" },

      {
        property: "og:description",
        content:
          "One shared inbox for WhatsApp and website chat, with an AI assistant on duty 24/7.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        // Noto Sans Arabic is split by character range, so an English page
        // downloads none of it.
        href: "https://fonts.googleapis.com/css2?family=Gabarito:wght@500;600;700;800&family=Onest:wght@400;500;600;700&family=Noto+Sans+Arabic:wght@400;500;600;700&display=swap",
      },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  const { uiLanguage } = Route.useRouteContext();
  return (
    <html lang={uiLanguage} dir={directionOf(uiLanguage)}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient, uiLanguage } = Route.useRouteContext();
  // App pages mark their own language inside the shell, so the translated
  // sidebar keeps the reader's direction; public pages are marked here.
  const { pathname, inApp } = useRouterState({
    select: (s) => ({
      pathname: s.location.pathname,
      inApp: s.matches.some((m) => m.routeId === "/_authenticated"),
    }),
  });

  // Frontend crashes, failed server actions and blank screens are captured with
  // route + session context so support can trace any incident.
  useEffect(() => {
    installTelemetry();
    installStaleChunkRecovery();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider language={uiLanguage}>
        <AuthProvider>
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          {inApp ? (
            <Outlet />
          ) : (
            <PageLanguage pathname={pathname}>
              <Outlet />
            </PageLanguage>
          )}
          {/* Toasts sit on the reading-end side: top-left in Arabic. */}
          <Toaster position={isRtlUiLanguage(uiLanguage) ? "top-left" : "top-right"} richColors />
        </AuthProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
