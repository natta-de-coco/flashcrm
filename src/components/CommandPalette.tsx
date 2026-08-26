import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "@tanstack/react-router";
import {
  FileText,
  Inbox,
  LayoutDashboard,
  Mail,
  Megaphone,
  Package,
  Settings,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";

type Hit = { id: string; label: string; sub?: string; to: string };

const PAGES: Hit[] = [
  { id: "p-dash", label: "Home", sub: "Dashboard", to: "/dashboard" },
  { id: "p-inbox", label: "Inbox", sub: "All conversations", to: "/inbox" },
  { id: "p-contacts", label: "Contacts", sub: "People & pipeline", to: "/contacts" },
  { id: "p-marketing", label: "Leads & Marketing", sub: "Capture & campaigns", to: "/marketing" },
  { id: "p-social", label: "Social Hub", sub: "Accounts & engagement", to: "/social" },
  { id: "p-content", label: "Content & SEO", sub: "Posts & articles", to: "/content" },
  { id: "p-seo", label: "SEO Studio", sub: "Image-to-post AI", to: "/seo-blog" },
  { id: "p-catalog", label: "Products", sub: "Catalog", to: "/catalog" },
  { id: "p-monitor", label: "Monitoring", sub: "Alerts & webhooks", to: "/monitoring" },
  { id: "p-settings", label: "Settings", sub: "Numbers, keys & team", to: "/settings" },
];

const ICONS: Record<string, typeof Inbox> = {
  "/dashboard": LayoutDashboard,
  "/inbox": Inbox,
  "/contacts": Users,
  "/marketing": Mail,
  "/social": Megaphone,
  "/content": FileText,
  "/seo-blog": FileText,
  "/catalog": Package,
  "/monitoring": Settings,
  "/settings": Settings,
};

/**
 * Universal search (Cmd/Ctrl + K). Jumps to any page and searches live
 * CRM records — contacts, products and articles — scoped by RLS to the
 * signed-in company.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [records, setRecords] = useState<{ contacts: Hit[]; products: Hit[]; articles: Hit[] }>({
    contacts: [],
    products: [],
    articles: [],
  });

  // Global shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // Debounced record search; only fires once the query is meaningful.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setRecords({ contacts: [], products: [], articles: [] });
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const like = `%${term}%`;
      const [contacts, products, articles] = await Promise.all([
        supabase
          .from("contacts")
          .select("id, name, phone, email, company")
          .or(`name.ilike.${like},phone.ilike.${like},email.ilike.${like},company.ilike.${like}`)
          .limit(6),
        supabase.from("products").select("id, title, sku").ilike("title", like).limit(5),
        supabase.from("seo_articles").select("id, title, status").ilike("title", like).limit(5),
      ]);
      if (cancelled) return;
      setRecords({
        contacts: (contacts.data ?? []).map((c) => ({
          id: c.id,
          label: c.name,
          sub: c.phone ?? c.email ?? c.company ?? "Contact",
          to: "/contacts",
        })),
        products: (products.data ?? []).map((p) => ({
          id: p.id,
          label: p.title,
          sub: p.sku ?? "Product",
          to: "/catalog",
        })),
        articles: (articles.data ?? []).map((a) => ({
          id: a.id,
          label: a.title,
          sub: a.status,
          to: "/seo-blog",
        })),
      });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q]);

  const go = (to: string) => {
    onOpenChange(false);
    setQ("");
    void navigate({ to });
  };

  const groups: { heading: string; hits: Hit[] }[] = [
    { heading: "Pages", hits: PAGES },
    { heading: "Contacts", hits: records.contacts },
    { heading: "Products", hits: records.products },
    { heading: "Articles", hits: records.articles },
  ];

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search Flash — pages, contacts, products, articles…"
        value={q}
        onValueChange={setQ}
      />
      <CommandList>
        <CommandEmpty>
          {q.trim().length < 2 ? "Type at least 2 characters to search records." : "No matches found."}
        </CommandEmpty>
        {groups.map((group) =>
          group.hits.length ? (
            <CommandGroup key={group.heading} heading={group.heading}>
              {group.hits.map((hit) => {
                const Icon = ICONS[hit.to] ?? FileText;
                return (
                  <CommandItem
                    key={`${group.heading}-${hit.id}`}
                    value={`${hit.label} ${hit.sub ?? ""} ${group.heading}`}
                    onSelect={() => go(hit.to)}
                  >
                    <Icon className="mr-2 size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{hit.label}</span>
                    {hit.sub ? (
                      <span className="ml-auto truncate pl-3 text-xs text-muted-foreground">
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
