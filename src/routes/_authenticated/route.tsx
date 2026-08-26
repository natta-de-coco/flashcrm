import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { FlashLogoBadge } from "@/components/FlashLogoBadge";
import { OnboardingModal } from "@/components/OnboardingModal";
import { useAuth } from "@/hooks/useAuth";
import { TenantProvider } from "@/hooks/useTenant";
import { cn } from "@/lib/utils";
import {
  Link,
  Outlet,
  createFileRoute,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import {
  Activity,
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
  Settings,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

/*
 * Grouped navigation. Every item carries a one-line caption so each selection
 * explains itself — no guessing what a module does.
 */
const NAV_SECTIONS = [
  {
    title: "Chats",
    items: [
      { to: "/inbox", label: "Inbox", desc: "WhatsApp & website chats", icon: Inbox },
      { to: "/social", label: "Social Hub", desc: "IG, FB, YouTube, X & more", icon: Megaphone },
      { to: "/chatbot", label: "Chatbot", desc: "AI auto-replies", icon: Bot },
    ],
  },
  {
    title: "Overview",
    items: [
      { to: "/dashboard", label: "Dashboard", desc: "Live pulse of every channel", icon: LayoutDashboard },
      { to: "/monitoring", label: "Monitoring", desc: "Alerts, webhooks & Meta health", icon: Activity },
    ],
  },
  {
    title: "Grow",
    items: [
      { to: "/contacts", label: "Contacts", desc: "People & pipeline", icon: Users },
      { to: "/marketing", label: "Leads & Marketing", desc: "Capture, consent, campaigns", icon: Mail },
      { to: "/catalog", label: "Product Catalog", desc: "What you sell", icon: Package },
      { to: "/content", label: "Content & SEO", desc: "Posts & articles", icon: FileText },
      { to: "/seo-blog", label: "SEO Studio", desc: "Image-to-post AI studio", icon: Sparkles },
    ],
  },
  {
    title: "Manage",
    items: [{ to: "/settings", label: "Settings", desc: "Numbers, keys & team", icon: Settings }],
  },
  {
    title: "Setup",
    items: [
      { to: "/connect", label: "Connect & setup", desc: "Link WhatsApp & your website", icon: Plug },
    ],
  },
] as const;

const MANAGER_SECTION = {
  title: "Manager",
  items: [
    { to: "/companies", label: "Companies", desc: "All client workspaces", icon: Building2 },
  ],
} as const;

const SIDEBAR_MIN = 224;
const SIDEBAR_MAX = 360;
const SIDEBAR_KEY = "flash.sidebar.width";

type NavSection = {
  title: string;
  items: readonly { to: string; label: string; desc: string; icon: LucideIcon }[];
};

/** Shared grouped nav — used by the desktop sidebar and the mobile drawer. */
function NavMenu({
  sections,
  onNavigate,
}: {
  sections: readonly NavSection[];
  onNavigate?: () => void;
}) {
  return (
    <>
      {sections.map((section) => (
        <div key={section.title}>
          <p className="mb-0.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/45">
            {section.title}
          </p>
          <div className="flex flex-col gap-0.5">
            {section.items.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={onNavigate}
                className="flex items-start gap-3 rounded-lg px-3 py-1.5 text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                activeProps={{
                  className: cn("bg-sidebar-accent text-sidebar-accent-foreground"),
                }}
              >
                <item.icon className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium leading-tight">
                    {item.label}
                  </span>
                  <span className="block truncate text-[11px] leading-tight text-sidebar-foreground/50">
                    {item.desc}
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

function AuthenticatedLayout() {
  const { session, loading, signOut, user, isSuperAdmin } = useAuth();
  const navigate = useNavigate();
  const [sidebarW, setSidebarW] = useState(264);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const sections = isSuperAdmin ? [...NAV_SECTIONS, MANAGER_SECTION] : NAV_SECTIONS;

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  // Auto-close the mobile drawer on any route change (nav links, back button, redirects).
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Restore the user's preferred sidebar width (client-only, after hydration).
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
    const move = (ev: PointerEvent) =>
      setSidebarW(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startW + ev.clientX - startX)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // Cold builds can take a moment to hydrate the session. Show the real shell
  // as a calm skeleton instead of a jarring full-screen text flash.
  if (loading || !session) {
    return (
      <div className="flex min-h-screen bg-background">
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
          {/* Mirrors the real mobile/tablet header so nothing jumps on hydration. */}
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
            <span className="sr-only">Loading your workspace…</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <TenantProvider>
      <OnboardingModal />
      <div className="flex min-h-screen bg-background">
        {/* Fixed sidebar — pinned, fits without scrolling, desktop (lg+) only */}
        <aside
          className="sticky top-0 hidden h-screen shrink-0 flex-col bg-sidebar p-4 text-sidebar-foreground lg:flex"
          style={{ width: sidebarW }}
        >
          <Link to="/dashboard" className="mb-4 flex items-center gap-3 px-2">
            <FlashLogoBadge className="size-10" />
            <span className="text-base font-bold">Flash&nbsp;CRM</span>
          </Link>

          <nav className="flash-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain">
            <NavMenu sections={sections} />
          </nav>

          <div className="border-t border-sidebar-border pt-3">
            <p className="truncate px-3 pb-2 text-xs text-sidebar-foreground/60">{user?.email}</p>
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              onClick={() => {
                void signOut();
              }}
            >
              <LogOut className="size-4" />
              Sign out
            </Button>
          </div>

          {/* Drag handle — pull the sidebar wider or narrower */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            onPointerDown={onDragStart}
            className="absolute inset-y-0 -right-1 w-2 cursor-col-resize transition-colors hover:bg-sidebar-primary/30"
          />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile/tablet header — sidebar hides below lg; hamburger opens the nav drawer */}
          <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-sidebar-border bg-sidebar px-3 text-sidebar-foreground lg:hidden">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Open menu"
                  className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                >
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="flash-scroll w-72 overflow-y-auto border-sidebar-border bg-sidebar p-4 text-sidebar-foreground [&>button]:text-sidebar-foreground/70"
              >
                <SheetHeader className="mb-4">
                  <SheetTitle className="flex items-center gap-2 text-sidebar-foreground">
                    <FlashLogoBadge className="size-8" />
                    Flash CRM
                  </SheetTitle>
                </SheetHeader>
                <nav className="flex flex-col gap-4">
                  <NavMenu sections={sections} onNavigate={() => setMobileOpen(false)} />
                </nav>
                <div className="mt-4 border-t border-sidebar-border pt-3">
                  <p className="truncate px-3 pb-2 text-xs text-sidebar-foreground/60">
                    {user?.email}
                  </p>
                  <Button
                    variant="ghost"
                    className="w-full justify-start gap-3 text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    onClick={() => {
                      setMobileOpen(false);
                      void signOut();
                    }}
                  >
                    <LogOut className="size-4" />
                    Sign out
                  </Button>
                </div>
              </SheetContent>
            </Sheet>
            <Link to="/dashboard" className="flex items-center gap-2">
              <FlashLogoBadge className="size-8" />
              <span className="text-sm font-bold">Flash&nbsp;CRM</span>
            </Link>
          </header>
          <Outlet />
        </div>
      </div>
    </TenantProvider>
  );
}
