import { createElement, type AnchorHTMLAttributes } from "react";
let currentSearch: Record<string, string> = {};
export function createFileRoute(_path: string) {
  return (_options: unknown) => ({ useSearch: () => currentSearch });
}
export function Link({
  to,
  search,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; search?: Record<string, string> }) {
  const query = new URLSearchParams(search).toString();
  return createElement(
    "a",
    {
      ...props,
      href: to + (query ? `?${query}` : ""),
      onClick: (event: React.MouseEvent) => {
        event.preventDefault();
        currentSearch = search ?? {};
        window.dispatchEvent(new CustomEvent("preview:navigate", { detail: { to, search } }));
      },
    },
    children,
  );
}
