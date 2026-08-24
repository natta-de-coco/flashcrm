import { Button } from "@/components/ui/button";
import { FlashLogoBadge } from "@/components/FlashLogoBadge";
import { OnboardingModal } from "@/components/OnboardingModal";
import { useAuth } from "@/hooks/useAuth";
import { TenantProvider } from "@/hooks/useTenant";
import { cn } from "@/lib/utils";
import { Link, Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
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
  Package,
  Plug,
  Settings,
  Sparkles,
  Users,
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
    title: "Start here",
    items: [
      { to: "/connect", label: "Connect & setup", desc: "Link WhatsApp & your website", icon: Plug },
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
    title: "Engage",
    items: [
      { to: "/inbox", label: "Inbox", desc: "WhatsApp & website chats", icon: Inbox },
      { to: "/social", label: "Social Hub", desc: "Comments, DMs & reach", icon: Megaphone },
      { to: "/chatbot", label: "Chatbot", desc: "AI auto-replies", icon: Bot },
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

function AuthenticatedLayout() {
  const { session, loading, signOut, user, isSuperAdmin } = useAuth();
  const navigate = useNavigate();
  const [sidebarW, setSidebarW] = useState(264);

  const sections = isSuperAdmin ? [...NAV_SECTIONS, MANAGER_SECTION] : NAV_SECTIONS;

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth" });
  }, [loading, session, navigate]);

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

  if (loading || !session) {
    return (
      <div className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">
        Loading your workspace…
      </div>
    );
  }

  return (
    <TenantProvider>
      <OnboardingModal />
      <div className="flex min-h-screen bg-background">
        <aside
          className="relative hidden shrink-0 flex-col bg-sidebar p-4 text-sidebar-foreground md:flex"
          style={{ width: sidebarW }}
        >
          <Link to="/dashboard" className="mb-6 flex items-center gap-3 px-2">
            <FlashLogoBadge className="size-10" />
            <span className="text-base font-bold tracking-tight">Flash CRM</span>
          </Link>

          <nav className="flex flex-1 flex-col gap-4 overflow-y-auto pr-1">
            {sections.map((section) => (
              <div key={section.title}>
                <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/45">
                  {section.title}
                </p>
                <div className="flex flex-col gap-0.5">
                  {section.items.map((item) => (
                    <Link
                      key={item.to}
                      to={item.to}
                      className="flex items-start gap-3 rounded-lg px-3 py-2 text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
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
          <div className="flex gap-1 overflow-x-auto border-b bg-sidebar px-2 py-2 md:hidden">
            {sections.flatMap((s) =>
              s.items.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-sidebar-foreground/75"
                  activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground" }}
                >
                  <item.icon className="size-3.5" />
                  {item.label}
                </Link>
              )),
            )}
          </div>
          <Outlet />
        </div>
      </div>
    </TenantProvider>
  );
}
