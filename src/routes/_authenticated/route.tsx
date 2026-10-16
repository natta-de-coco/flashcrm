import { AppFrame } from "@/components/AppFrame";
import { AppearanceMenu } from "@/components/AppearanceMenu";
import { useLocale } from "@/hooks/useLocale";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { FlashLogoBadge } from "@/components/FlashLogoBadge";
import { OnboardingModal } from "@/components/OnboardingModal";
import { CommandPalette } from "@/components/CommandPalette";
import { QuickCreate } from "@/components/QuickCreate";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { ProfileBanner } from "@/components/ProfileBanner";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { PageLanguage } from "@/components/PageLanguage";

import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { hasMessage, navMessageKey, workspaceDefaultLanguage } from "@/lib/i18n";
import { TenantProvider, useTenant } from "@/hooks/useTenant";
import { useNavAccess } from "@/hooks/useNavAccess";
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
  PanelLeft,
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
  onNavigate,
  collapsed = false,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  // The sections arrive already filtered for the signed-in role, by the same rule
  // as the phone bar, search and "+ Create" (hooks/useNavAccess): platform pages
  // only for platform staff, nothing privileged for an unknown role. This file
  // never names a role.
  const { sections, loading } = useNavAccess();
  const { t } = useI18n();
  // A nav entry with no translation key keeps its English text rather than
  // showing the key itself.
  const text = (key: string, fallback: string) => (hasMessage(key) ? t(key) : fallback);

  if (loading) return null;

  return (
    <>
      {sections.map((section) => (
        <div key={section.title} className="crm-nav-section">
          <p className="crm-nav-heading mb-2 px-3 text-xs font-medium text-muted-foreground">
            {text(`nav.section.${section.id}`, section.title)}
          </p>
          <div className="flex flex-col gap-0.5">
            {section.items.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={onNavigate}
                title={text(navMessageKey(item.to, "label"), item.label)}
                aria-label={
                  collapsed ? text(navMessageKey(item.to, "label"), item.label) : undefined
                }
                className="crm-nav-link flex min-h-10 items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                activeProps={{
                  className: cn(
                    "bg-sidebar-accent text-sidebar-accent-foreground border-sidebar-border shadow-sm",
                  ),
                }}
              >
                <item.icon className="size-[18px] shrink-0" />
                <span className="crm-nav-label min-w-0">
                  <span className="block truncate text-sm font-medium leading-tight">
                    {text(navMessageKey(item.to, "label"), item.label)}
                  </span>
                  <span className="sr-only">{text(navMessageKey(item.to, "desc"), item.desc)}</span>
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
    if (next) setLanguage(next, { inherited: true });
  }, [tenant?.locale, language, setLanguage]);
  return null;
}

function AuthenticatedLayout() {
  const { session, loading, signOut, user } = useAuth();
  const { t, dir } = useI18n();
  const navigate = useNavigate();
  // Reads saved locale from DB and applies lang + dir to <html> live.
  // Must be called inside the QueryClientProvider (which wraps this tree).
  useLocale();
  const [sidebarW, setSidebarW] = useState(264);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

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
    try {
      const saved = Number(window.localStorage.getItem(SIDEBAR_KEY));
      if (saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX) setSidebarW(saved);
    } catch {
      /* use the default when storage is disabled */
    }
  }, []);
  function saveSidebarWidth(width: number) {
    const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width));
    setSidebarW(next);
    try {
      window.localStorage.setItem(SIDEBAR_KEY, String(next));
    } catch {
      /* still resizable */
    }
  }

  function onDragStart(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarW;
    // In Arabic the sidebar sits on the right, so dragging its edge left widens it.
    const grow = (ev: PointerEvent) => (dir === "rtl" ? startX - ev.clientX : ev.clientX - startX);
    const move = (ev: PointerEvent) => saveSidebarWidth(startW + grow(ev));
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
      <AppFrame
        sidebarWidth={sidebarW}
        collapsed={collapsed}
        sidebar={
          <>
            <WorkspaceIdentity />
            <nav
              aria-label={t("shell.primaryNav")}
              className="flash-scroll flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-3 py-3"
            >
              <NavMenu collapsed={collapsed} />
            </nav>
            <div className="m-3 rounded-xl border bg-background p-2">
              {!collapsed && <LanguageSwitcher className="w-full justify-start" />}
              <p
                className="crm-workspace-label truncate px-2 pb-2 pt-1 text-xs text-muted-foreground"
                dir="ltr"
              >
                {user?.email}
              </p>
              <Button
                variant="ghost"
                className={cn("w-full gap-2", collapsed ? "justify-center px-0" : "justify-start")}
                aria-label={t("shell.signOut")}
                title={t("shell.signOut")}
                onClick={() => void signOut()}
              >
                <LogOut className="size-4" />
                <span className="crm-workspace-label">{t("shell.signOut")}</span>
              </Button>
            </div>
            {!collapsed && (
              <div
                role="separator"
                tabIndex={0}
                aria-orientation="vertical"
                aria-label={t("shell.resizeSidebar")}
                aria-valuemin={SIDEBAR_MIN}
                aria-valuemax={SIDEBAR_MAX}
                aria-valuenow={sidebarW}
                onPointerDown={onDragStart}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                    event.preventDefault();
                    saveSidebarWidth(
                      sidebarW + (event.key === "ArrowRight" ? 16 : -16) * (dir === "rtl" ? -1 : 1),
                    );
                  }
                }}
                className="absolute inset-y-0 -end-1 w-2 cursor-col-resize z-10 hover:bg-sidebar-primary/10 focus-visible:bg-sidebar-primary/20 focus-visible:outline-none"
              />
            )}
          </>
        }
        header={
          <>
            <Button
              variant="ghost"
              size="icon"
              className="hidden shrink-0 lg:inline-flex"
              aria-label={t(collapsed ? "shell.expandSidebar" : "shell.collapseSidebar")}
              aria-expanded={!collapsed}
              onClick={() => setCollapsed(!collapsed)}
            >
              <PanelLeft className="size-4" />
            </Button>
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 lg:hidden"
                  aria-label={t("shell.openMenu")}
                >
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent
                side={dir === "rtl" ? "right" : "left"}
                className="flash-scroll w-72 overflow-y-auto bg-sidebar p-4 text-sidebar-foreground"
              >
                <SheetHeader className="mb-4">
                  <SheetTitle className="flex items-center gap-2">
                    <FlashLogoBadge className="size-8" /> Flas CRM
                  </SheetTitle>
                </SheetHeader>
                <nav aria-label={t("shell.primaryNav")} className="flex flex-col gap-5">
                  <NavMenu onNavigate={() => setMobileOpen(false)} />
                </nav>
                <div className="mt-5 border-t pt-3">
                  <LanguageSwitcher className="w-full justify-start" />
                  <p className="truncate px-3 py-2 text-xs text-muted-foreground" dir="ltr">
                    {user?.email}
                  </p>
                  <Button
                    variant="ghost"
                    className="w-full justify-start gap-3"
                    onClick={() => {
                      setMobileOpen(false);
                      void signOut();
                    }}
                  >
                    <LogOut className="size-4" />
                    {t("shell.signOut")}
                  </Button>
                </div>
              </SheetContent>
            </Sheet>
            <span className="hidden h-5 w-px shrink-0 bg-border sm:block" />
            <CurrentPageTitle />
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label={t("shell.searchLabel")}
              className="ms-auto flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted sm:h-9 sm:w-52 sm:justify-start sm:gap-2 sm:border sm:bg-muted/40 sm:px-3"
            >
              <Search className="size-4 shrink-0" />
              <span className="hidden truncate text-sm sm:inline">{t("shell.search")}</span>
              <kbd className="ms-auto hidden rounded border bg-background px-1.5 py-0.5 text-[10px] lg:inline">
                {shortcutHint()}
              </kbd>
            </button>
            <div className={cn("hidden sm:block", !collapsed && "lg:hidden")}>
              <LanguageSwitcher />
            </div>
            <AppearanceMenu />
            <div className="hidden sm:block">
              <QuickCreate />
            </div>
            <div className="sm:hidden">
              <QuickCreate compact />
            </div>
          </>
        }
        mobileNav={<MobileBottomNav onMore={() => setMobileOpen(true)} />}
      >
        <ProfileBanner />
        {shellOwnsMain ? (
          <main
            id="content"
            data-inbox={pathname === "/inbox" || undefined}
            className="min-h-0 flex-1 p-4 sm:p-6"
          >
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
      </AppFrame>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </TenantProvider>
  );
}

function WorkspaceIdentity() {
  const { tenant, loading } = useTenant();
  return (
    <Link
      to="/dashboard"
      className="mx-3 mb-1 flex min-h-16 min-w-0 items-center gap-3 px-2"
      title={tenant?.name ?? "Flas CRM"}
    >
      <FlashLogoBadge className="size-10 shrink-0" />
      <span className="crm-workspace-label min-w-0">
        <span className="block text-sm font-semibold">Flas CRM</span>
        {loading ? (
          <Skeleton className="mt-1 h-3 w-24" />
        ) : (
          <span className="block truncate text-xs text-muted-foreground">
            {tenant?.name ?? "Flas CRM"}
          </span>
        )}
      </span>
    </Link>
  );
}

function CurrentPageTitle() {
  const { sections } = useNavAccess();
  const { tx } = useI18n();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const item = sections
    .flatMap((section) => section.items)
    .find((entry) => pathname === entry.to || pathname.startsWith(entry.to + "/"));
  return (
    <span className="min-w-0 flex-1 truncate text-sm font-semibold sm:me-3">
      {item ? tx(navMessageKey(item.to, "label"), item.label) : "Flas CRM"}
    </span>
  );
}
