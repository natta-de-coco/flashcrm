import type { ReactNode } from "react";

/** The Nexora inset layout, using slots for FLAS's permission-aware controls. */
export function AppFrame({
  sidebar,
  header,
  mobileNav,
  children,
  sidebarWidth = 264,
  collapsed = false,
}: {
  sidebar: ReactNode;
  header: ReactNode;
  mobileNav?: ReactNode;
  children: ReactNode;
  sidebarWidth?: number;
  collapsed?: boolean;
}) {
  return (
    <div
      className="crm-frame flex h-dvh min-h-0 bg-sidebar text-foreground lg:gap-2 lg:py-2 lg:pe-2"
      data-app-shell
    >
      <aside
        className="crm-sidebar relative hidden min-h-0 shrink-0 flex-col text-sidebar-foreground lg:flex"
        style={{ width: collapsed ? 76 : sidebarWidth }}
        data-collapsed={collapsed}
      >
        {sidebar}
      </aside>
      <div className="crm-workspace flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background lg:rounded-2xl lg:border lg:shadow-sm">
        <header className="crm-header z-30 flex min-h-14 shrink-0 items-center gap-2 border-b bg-background px-3 sm:gap-3 sm:px-5">
          {header}
        </header>
        <div className="crm-content flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          {children}
        </div>
        {mobileNav}
      </div>
    </div>
  );
}
