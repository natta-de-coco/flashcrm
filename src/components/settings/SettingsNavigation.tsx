import {
  Bell,
  Building2,
  CreditCard,
  FileImage,
  Plug,
  Search,
  ShieldCheck,
  Shield,
  UserRound,
  Users,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/hooks/useI18n";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { settingsSectionsFor, type SettingsSection } from "@/lib/settings-workspace";

const ICONS = {
  profile: UserRound,
  security: ShieldCheck,
  company: Building2,
  invoices: FileImage,
  notifications: Bell,
  team: Users,
  billing: CreditCard,
  connections: Plug,
  privacy: Shield,
};
export function SettingsNavigation({
  role,
  selected,
  onSelect,
}: {
  role: string | null | undefined;
  selected: SettingsSection;
  onSelect: (section: SettingsSection) => void;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const sections = settingsSectionsFor(role);
  const needle = search.trim().toLocaleLowerCase();
  const visible = sections.filter((section) =>
    `${t(`settingsWorkspace.${section.id}.label`)} ${t(`settingsWorkspace.${section.id}.desc`)} ${section.keywords}`
      .toLocaleLowerCase()
      .includes(needle),
  );
  return (
    <nav
      aria-label={t("settingsWorkspace.sections")}
      className="rounded-xl border bg-card p-3 lg:sticky lg:top-4"
    >
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute start-3 top-3 size-4 text-muted-foreground" />
        <Input
          className="ps-9"
          aria-label={t("settingsWorkspace.search")}
          placeholder={t("settingsWorkspace.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-1 lg:flex-col">
        {(["account", "workspace"] as const).map((group) => {
          const groupItems = visible.filter((section) => section.group === group);
          return groupItems.length ? (
            <div key={group} className="contents lg:block">
              <p className="mb-1 mt-3 hidden px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground lg:block">
                {t(`settingsWorkspace.group.${group}`)}
              </p>
              {groupItems.map((section) => {
                const Icon = ICONS[section.id];
                return (
                  <button
                    type="button"
                    key={section.id}
                    aria-current={selected === section.id ? "page" : undefined}
                    aria-controls={`settings-${section.id}`}
                    onClick={() => onSelect(section.id)}
                    className={cn(
                      "flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-start text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:w-full",
                      selected === section.id
                        ? "bg-primary/10 font-semibold text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span>{t(`settingsWorkspace.${section.id}.label`)}</span>
                  </button>
                );
              })}
            </div>
          ) : null;
        })}
      </div>
      {!visible.length && (
        <p className="p-3 text-sm text-muted-foreground" role="status">
          {t("settingsWorkspace.noMatches")}
        </p>
      )}
    </nav>
  );
}
