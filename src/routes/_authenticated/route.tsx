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
  Package,
  Settings,
  Users,
} from "lucide-react";
import { useEffect } from "react";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/inbox", label: "Inbox", icon: Inbox },
  { to: "/contacts", label: "Contacts", icon: Users },
  { to: "/marketing", label: "Leads & Marketing", icon: Mail },
  { to: "/catalog", label: "Product Catalog", icon: Package },
  { to: "/content", label: "Content & SEO", icon: FileText },
  { to: "/chatbot", label: "Chatbot", icon: Bot },
  { to: "/monitoring", label: "Monitoring", icon: Activity },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

function AuthenticatedLayout() {
  const { session, loading, signOut, user, isSuperAdmin } = useAuth();
  const navigate = useNavigate();

  // Platform manager gets the companies portal on top of the normal workspace nav.
  const nav = isSuperAdmin
    ? [...NAV, { to: "/companies", label: "Companies", icon: Building2 } as const]
    : NAV;

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth" });
  }, [loading, session, navigate]);

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
        <aside className="hidden w-60 shrink-0 flex-col bg-sidebar p-4 text-sidebar-foreground md:flex">
          <Link to="/dashboard" className="mb-8 flex items-center gap-3 px-2">
            <FlashLogoBadge className="size-10" />
            <span className="text-base font-bold tracking-tight">Flash CRM</span>
          </Link>

        <nav className="flex flex-1 flex-col gap-1">
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              activeProps={{
                className: cn("bg-sidebar-accent text-sidebar-accent-foreground"),
              }}
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
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
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex gap-1 overflow-x-auto border-b bg-sidebar px-2 py-2 md:hidden">
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-sidebar-foreground/75"
              activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground" }}
            >
              {item.label}
            </Link>
          ))}
        </div>
        <Outlet />
      </div>
      </div>
    </TenantProvider>
  );
}
