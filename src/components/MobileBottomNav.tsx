import { useI18n } from "@/hooks/useI18n";
import { navMessageKey } from "@/lib/i18n";
import { useNavAccess } from "@/hooks/useNavAccess";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { Menu } from "lucide-react";

/**
 * Phone/tablet bottom navigation for the things people actually do on the
 * move. The tabs are entries from the menu itself (lib/navigation.ts) and are
 * named with the menu's own translation keys, so this bar can never call a
 * screen something the sidebar does not. "More" opens the same drawer as the
 * header hamburger. The tabs arrive already filtered for the signed-in role, by
 * the same rule as the sidebar, search and "+ Create" (hooks/useNavAccess); this
 * file never names a role. A tab with a short name for the
 * bar (`barLabel`, a word taken from its full name) shows that, because five
 * slots on a 375px phone cannot hold "Machapisho ya Mitandao".
 */
export function MobileBottomNav({ onMore }: { onMore: () => void }) {
  const { t, tx } = useI18n();
  const { mobileBar } = useNavAccess();
  return (
    <nav
      data-mobile-nav
      aria-label={t("shell.primaryNav")}
      className="sticky bottom-0 z-40 flex items-stretch border-t border-sidebar-border bg-sidebar text-sidebar-foreground lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {mobileBar.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className="flex min-h-[3.25rem] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-medium text-sidebar-foreground/60 transition-colors"
          activeProps={{ className: cn("text-sidebar-accent-foreground") }}
        >
          <item.icon className="size-5" />
          <span className="line-clamp-2 text-center leading-tight">
            {item.barLabel
              ? tx(navMessageKey(item.to, "bar"), item.barLabel)
              : tx(navMessageKey(item.to, "label"), item.label)}
          </span>
        </Link>
      ))}
      <button
        type="button"
        onClick={onMore}
        className="flex min-h-[3.25rem] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-medium text-sidebar-foreground/60"
      >
        <Menu className="size-5" />
        <span className="line-clamp-2 text-center leading-tight">{t("shell.more")}</span>
      </button>
    </nav>
  );
}
