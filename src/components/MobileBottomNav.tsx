import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { Inbox, LayoutDashboard, Megaphone, Menu, Users } from "lucide-react";

const ITEMS = [
  { to: "/dashboard", label: "Home", icon: LayoutDashboard },
  { to: "/inbox", label: "Inbox", icon: Inbox },
  { to: "/marketing", label: "Leads", icon: Users },
  { to: "/social", label: "Social", icon: Megaphone },
] as const;

/**
 * Phone/tablet bottom navigation for the five things people actually do on
 * the move. "More" opens the same drawer as the header hamburger.
 */
export function MobileBottomNav({ onMore }: { onMore: () => void }) {
  return (
    <nav
      aria-label="Primary"
      className="sticky bottom-0 z-40 flex items-stretch border-t border-sidebar-border bg-sidebar text-sidebar-foreground lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {ITEMS.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className="flex min-h-[3.25rem] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium text-sidebar-foreground/60 transition-colors"
          activeProps={{ className: cn("text-sidebar-accent-foreground") }}
        >
          <item.icon className="size-5" />
          {item.label}
        </Link>
      ))}
      <button
        type="button"
        onClick={onMore}
        className="flex min-h-[3.25rem] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium text-sidebar-foreground/60"
      >
        <Menu className="size-5" />
        More
      </button>
    </nav>
  );
}
