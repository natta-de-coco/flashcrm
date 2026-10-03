import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { FlashLogoBadge } from "@/components/FlashLogoBadge";
import { OnboardingModal } from "@/components/OnboardingModal";
import { CommandPalette } from "@/components/CommandPalette";
import { QuickCreate } from "@/components/QuickCreate";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { PageLanguage } from "@/components/PageLanguage";

import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { hasMessage, navMessageKey, workspaceDefaultLanguage } from "@/lib/i18n";
import { TenantProvider, useTenant } from "@/hooks/useTenant";
import { canReach } from "@/lib/permissions";
import { MANAGER_SECTION, NAV_SECTIONS, type NavSection } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { touchPresence } from "@/lib/presence.functions";
import { supabase } from "@/integrations/supabase/client";
import { Link, Outlet, createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Bug,
  Bot,
  Building2,
  FileText,
  Inbox,
  LayoutDashboard,
  LogOut,
  Mail,
  Megaphone,
  Menu,
  Package,
  Plug,
  Receipt,
  Search,
  Settings,
  Briefcase,
  Sparkles,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function shortcutHint(): string {
  if (typeof navigator === "undefined") return "Ctrl K";
  const platform =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    "";
  return /mac|iphone|ipad|ipod/i.test(platform) ? "⌘K" : "Ctrl K";
}

const SIDEBAR_MIN = 224;
const SIDEBAR_MAX = 360;
const SIDEBAR_KEY = "flash.sidebar.width";

function NavMenu({
  sections,
  onNavigate,
}: {
  sections: readonly NavSection[];
  onNavigate?: () => void;
}) {
  const { staffRole, loading } = useTenant();
  const { t } = useI18n();
  // A nav entry with no translation key keeps its English text rather than
  // showing the key itself.
  const text = (key: string, fallback: string) => (hasMessage(key) ? t(key) : fallback);
  const visible = sections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => section.title === "Manager" || canReach(staffRole, item.to),
      ),
    }))
    .filter((section) => section.items.length > 0);

  if (loading) return null;

  return (
    <>
      {visible.map((section) => (
        <div key={section.title}>
          <p className="mb-0.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/45">
            {text(`nav.section.${section.title.toLowerCase()}`, section.title)}
          </p>
          <div className="flex flex-col gap-0.5">
            {section.items.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={onNavigate}
                className="flex items-start gap-3 rounded-lg px-3 py-1.5 text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                activeProps={{ className: cn("bg-sidebar-accent text-sidebar-accent-foreground") }}
              >
                <item.icon className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium leading-tight">
                    {text(navMessageKey(item.to, "label"), item.label)}
                  </span>
                  <span className="block truncate text-[11px] leading-tight text-sidebar-foreground/50">
                    {text(navMessageKey(item.to, "desc"), item.desc)}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * Applies the company's language for a teammate who has never chosen one.
 * Renders nothing; lives inside TenantProvider to read the workspace.
 */
function WorkspaceLanguageDefault() {
  const { tenant } = useTenant();
  const { language, setLanguage } = useI18n();
  useEffect(() => {
    const next = workspaceDefaultLanguage(document.cookie, tenant?.locale, language);
    if (next) setLanguage(next);
  }, [tenant?.locale, language, setLanguage]);
  return null;
}

function AuthenticatedLayout() {
  const { session, loading, signOut, user, isSuperAdmin } = useAuth();
  const { t, dir } = useI18n();
  const navigate = useNavigate();
  const [sidebarW, setSidebarW] = useState(264);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const sections = isSuperAdmin ? [...NAV_SECTIONS, MANAGER_SECTION] : NAV_SECTIONS;

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const beat = async () => {
      let { data } = await supabase.auth.getSession();
      if (!data.session) {
        const refreshed = await supabase.auth.refreshSession();
        data = refreshed.data;
      }
      if (cancelled || !data.session?.access_token) return;
      try {
        await touchPresence({ data: undefined });
      } catch {
        /* presence is best-effort */
      }
    };
    void beat();
    const timer = window.setInterval(() => {
      if (!cancelled && document.visibilityState === "visible") void beat();
    }, 120_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session]);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem(SIDEBAR_KEY));
    if (saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX) setSidebarW(saved);
  }, []);
  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_KEY, String(sidebarW));
  }, [sidebarW]);

  function onDragStart(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarW;
    // In Arabic the sidebar sits on the right, so dragging its edge left widens it.
    const grow = (ev: PointerEvent) => (dir === "rtl" ? startX - ev.clientX : ev.clientX - startX);
    const move = (ev: PointerEvent) =>
      setSidebarW(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startW + grow(ev))));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  if (loading || !session) {
    return (
      <div className="flex min-h-screen bg-background" data-app-shell>
        <aside
          className="sticky top-0 hidden h-screen shrink-0 flex-col gap-3 bg-sidebar p-4 lg:flex"
          style={{ width: sidebarW }}
        >
          <div className="mb-2 flex items-center gap-3 px-2">
            <Skeleton className="size-10 rounded-full bg-sidebar-accent/60" />
            <Skeleton className="h-4 w-24 bg-sidebar-accent/60" />
          </div>
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full bg-sidebar-accent/40" />
          ))}
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-14 items-center gap-3 border-b border-sidebar-border bg-sidebar px-3 lg:hidden">
            <Skeleton className="size-9 rounded-md bg-sidebar-accent/60" />
            <Skeleton className="size-8 rounded-full bg-sidebar-accent/60" />
            <Skeleton className="h-4 w-24 bg-sidebar-accent/60" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 sm:p-6">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64" />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
            <Skeleton className="h-64 w-full" />
            <span className="sr-only">{t("shell.loading")}</span>
          </div>
        </div>
      </div>
    );
  }

  // Inbox and Sales still render legacy top-level divs. Give those routes one
  // main landmark from the shell. Routes that already render <main> keep their
  // own landmark so we never create nested/duplicate main elements.
  const shellOwnsMain = pathname === "/inbox" || pathname === "/sales";

  return (
    <TenantProvider>
      <WorkspaceLanguageDefault />
      <OnboardingModal />
      <div className="flex min-h-screen bg-background" data-app-shell>
        <aside
          className="sticky top-0 hidden h-screen shrink-0 flex-col bg-sidebar p-4 text-sidebar-foreground lg:flex"
          style={{ width: sidebarW }}
        >
          <Link to="/dashboard" className="mb-4 flex items-center gap-3 px-2">
            <FlashLogoBadge className="size-10" />
            <span className="text-base font-bold">Flas&nbsp;CRM</span>
          </Link>

          <nav className="flash-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain">
            <NavMenu sections={sections} />
          </nav>

          <div className="border-t border-sidebar-border pt-3">
            <p className="truncate px-3 pb-2 text-xs text-sidebar-foreground/60">{user?.email}</p>
            <LanguageSwitcher className="w-full justify-start gap-3 text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" />
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              onClick={() => void signOut()}
            >
              <LogOut className="size-4" /> {t("shell.signOut")}
            </Button>
          </div>

          {/* -end-1: the sidebar's inner edge, which is its left side in Arabic. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("shell.resizeSidebar")}
            onPointerDown={onDragStart}
            className="absolute inset-y-0 -end-1 w-2 cursor-col-resize transition-colors hover:bg-sidebar-primary/30"
          />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-sidebar-border bg-sidebar px-3 text-sidebar-foreground lg:hidden">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("shell.openMenu")}
                  className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                >
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent
                // The menu slides in from the side the sidebar lives on.
                side={dir === "rtl" ? "right" : "left"}
                className="flash-scroll w-72 overflow-y-auto border-sidebar-border bg-sidebar p-4 text-sidebar-foreground [&>button]:text-sidebar-foreground/70"
              >
                <SheetHeader className="mb-4">
                  <SheetTitle className="flex items-center gap-2 text-sidebar-foreground">
                    <FlashLogoBadge className="size-8" /> Flas CRM
                  </SheetTitle>
                </SheetHeader>
                <nav className="flex flex-col gap-4">
                  <NavMenu sections={sections} onNavigate={() => setMobileOpen(false)} />
                </nav>
                <div className="mt-4 border-t border-sidebar-border pt-3">
                  <p className="truncate px-3 pb-2 text-xs text-sidebar-foreground/60">
                    {user?.email}
                  </p>
                  <LanguageSwitcher className="w-full justify-start gap-3 text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" />
                  <Button
                    variant="ghost"
                    className="w-full justify-start gap-3 text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    onClick={() => {
                      setMobileOpen(false);
                      void signOut();
                    }}
                  >
                    <LogOut className="size-4" /> {t("shell.signOut")}
                  </Button>
                </div>
              </SheetContent>
            </Sheet>
            <Link to="/dashboard" className="flex min-w-0 flex-1 items-center gap-2">
              <FlashLogoBadge className="size-8" />
              <span className="truncate text-sm font-bold">Flas&nbsp;CRM</span>
            </Link>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("shell.searchLabel")}
              onClick={() => setPaletteOpen(true)}
              className="shrink-0 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <Search className="size-5" />
            </Button>
            <QuickCreate compact />
          </header>

          <header className="sticky top-0 z-30 hidden h-14 items-center gap-3 border-b bg-background/95 px-6 backdrop-blur lg:flex">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="flex h-9 w-full max-w-md items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              <Search className="size-4" />
              {t("shell.search")}
              <kbd className="ms-auto rounded border bg-background px-1.5 py-0.5 text-[10px] font-medium">
                {shortcutHint()}
              </kbd>
            </button>
            <div className="ms-auto flex items-center gap-2">
              <LanguageSwitcher />
              <QuickCreate />
            </div>
          </header>

          {shellOwnsMain ? (
            <main id="content" className="min-h-0 flex-1 overflow-y-auto p-6">
              <PageLanguage pathname={pathname}>
                <Outlet />
              </PageLanguage>
            </main>
          ) : (
            <div id="content" className="contents">
              <PageLanguage pathname={pathname}>
                <Outlet />
              </PageLanguage>
            </div>
          )}
          <MobileBottomNav onMore={() => setMobileOpen(true)} />
        </div>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </TenantProvider>
  );
}
