import type { ReactNode } from "react";

/**
 * Consistent page header: title, one-line explanation of what the page does,
 * and an optional actions slot on the right. Use at the top of every module
 * page so each sidebar selection opens with clear context.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[1.75rem] font-bold leading-tight sm:text-3xl">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-[0.9375rem] text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
