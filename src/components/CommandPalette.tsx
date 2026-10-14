import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";
import type { NavItem } from "@/lib/navigation";
import { NO_RECORDS } from "@/lib/record-search";
import { useNavAccess } from "@/hooks/useNavAccess";
import { useNavigate } from "@tanstack/react-router";
import { FileText, Package, Users, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { navMessageKey } from "@/lib/i18n";

type Hit = {
  id: string;
  label: string;
  sub?: string;
  to: string;
  // Explicitly `| undefined` because exactOptionalPropertyTypes is on: a nav
  // item without keywords assigns undefined rather than omitting the key.
  keywords?: string | undefined;
  icon?: LucideIcon | undefined;
};

/**
 * Pages come from the one nav definition (useNavAccess hands over the sidebar's
 * own entries, filtered by the same permission rule), so search can no longer
 * fall behind the sidebar, call a page something else, or offer one the person
 * cannot open. It previously held its own copy and had drifted: Quotes &
 * Invoices, Chatbot, Campaign Planner and Integrations were all reachable from
 * the sidebar but unfindable here.
 */
const toHit = (item: NavItem): Hit => ({
  id: `p-${item.to}`,
  label: item.label,
  sub: item.desc,
  to: item.to,
  keywords: item.keywords,
  icon: item.icon,
});

/**
 * Universal search (Cmd/Ctrl + K). Jumps to any page the person may open and
 * searches live CRM records -- contacts, products and articles -- but only the
 * kinds their role can open (lib/record-search.ts), scoped by RLS to the
 * signed-in company.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t, tx } = useI18n();
  const navigate = useNavigate();
  // The pages and the record search both arrive already limited to the signed-in
  // role (hooks/useNavAccess); this file never names a role.
  const { palette, findRecords } = useNavAccess();
  const [q, setQ] = useState("");
  const [records, setRecords] = useState<{ contacts: Hit[]; products: Hit[]; articles: Hit[] }>({
    contacts: [],
    products: [],
    articles: [],
  });
  // True when the last record search could not run (a database error or a dropped
  // connection). That is not "no matches", and the screen must not say so.
  const [searchFailed, setSearchFailed] = useState(false);

  // Global shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // `key` is optional on a KeyboardEvent in practice: autofill, password
      // managers and IME composition all dispatch keydowns without one. This
      // listener is on window, so throwing here breaks whichever page the
      // customer happened to be on -- it surfaced as a crash on /sales, which
      // has nothing to do with the palette.
      if (typeof e.key !== "string") return;
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // Debounced record search; only fires once the query is meaningful, and only
  // asks about the kinds of record this role may open.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setRecords({ contacts: [], products: [], articles: [] });
      setSearchFailed(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      // A search that throws counts as failed, never as empty.
      const answer = await findRecords(supabase, term).catch(() => null);
      if (cancelled) return;
      setSearchFailed(answer === null || answer.failed.length > 0);
      const found = answer ?? NO_RECORDS;
      setRecords({
        contacts: found.contacts.map((c) => ({
          id: c.id,
          label: c.name,
          sub: c.phone ?? c.email ?? c.company ?? t("commandPalette.contact"),
          to: "/contacts",
          icon: Users,
        })),
        products: found.products.map((p) => ({
          id: p.id,
          label: p.title,
          sub: p.sku ?? t("commandPalette.product"),
          to: "/catalog",
          icon: Package,
        })),
        articles: found.articles.map((a) => ({
          id: a.id,
          label: a.title,
          sub: tx(`seoBlogIndex.status.${a.status}`, a.status),
          to: "/seo-blog",
          icon: FileText,
        })),
      });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q, findRecords, t, tx]);

  const go = (to: string) => {
    onOpenChange(false);
    setQ("");
    void navigate({ to });
  };

  const groups: { heading: string; hits: Hit[] }[] = [
    {
      heading: t("commandPalette.pages"),
      // Shown in the reader's language; the English name stays searchable.
      hits: palette.map(toHit).map((page) => ({
        ...page,
        label: tx(navMessageKey(page.to, "label"), page.label),
        ...(page.sub ? { sub: tx(navMessageKey(page.to, "desc"), page.sub) } : {}),
        keywords: `${page.keywords ?? ""} ${page.label}`,
      })),
    },
    { heading: t("commandPalette.contacts"), hits: records.contacts },
    { heading: t("commandPalette.products"), hits: records.products },
    { heading: t("commandPalette.articles"), hits: records.articles },
  ];

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder={t("commandPalette.searchFlasPagesContactsProducts")}
        value={q}
        onValueChange={setQ}
      />
      <CommandList>
        {searchFailed ? (
          <p role="alert" className="px-3 py-3 text-center text-sm text-destructive">
            {t("commandPalette.searchFailed")}
          </p>
        ) : (
          <CommandEmpty>
            {q.trim().length < 2
              ? t("commandPalette.typeAtLeast2Characters")
              : t("commandPalette.noMatchesFound")}
          </CommandEmpty>
        )}
        {groups.map((group) =>
          group.hits.length ? (
            <CommandGroup key={group.heading} heading={group.heading}>
              {group.hits.map((hit) => {
                const Icon = hit.icon ?? FileText;
                return (
                  <CommandItem
                    key={`${group.heading}-${hit.id}`}
                    value={`${hit.label} ${hit.sub ?? ""} ${hit.keywords ?? ""} ${group.heading}`}
                    onSelect={() => go(hit.to)}
                  >
                    <Icon className="me-2 size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{hit.label}</span>
                    {hit.sub ? (
                      <span className="ms-auto truncate ps-3 text-xs text-muted-foreground">
                        {hit.sub}
                      </span>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ) : null,
        )}
      </CommandList>
    </CommandDialog>
  );
}
