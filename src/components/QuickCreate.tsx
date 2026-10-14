import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { useNavAccess } from "@/hooks/useNavAccess";

/**
 * "+ Create" menu. Every entry lands on a real working flow — no dead
 * options — so the header shortcut always does something useful. The entries
 * live in lib/navigation.ts beside the menu, so what they open and what they
 * are called cannot drift from it. Only the actions the signed-in role may open
 * arrive here (the same rule as the sidebar, by hooks/useNavAccess; this file
 * never names a role), and a role with none gets no button.
 */
export function QuickCreate({ compact = false }: { compact?: boolean }) {
  const { t, tx } = useI18n();
  const navigate = useNavigate();
  const { quickCreate: actions } = useNavAccess();

  if (actions.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact ? (
          <Button size="icon" aria-label={t("quickCreate.create")} className="size-9 shrink-0">
            <Plus className="size-4" />
          </Button>
        ) : (
          <Button className="gap-1.5 rounded-full px-4">
            <Plus className="size-4" />
            {t("quickCreate.create")}
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>{t("quickCreate.create")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {actions.map(({ action, index }) => (
          <DropdownMenuItem
            key={action.label}
            onSelect={() =>
              void navigate(
                action.search ? { to: action.to, search: action.search } : { to: action.to },
              )
            }
            className="gap-2.5"
          >
            <action.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block text-sm font-medium leading-tight">
                {tx(`quickCreate.action.${index}.label`, action.label)}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {tx(`quickCreate.action.${index}.desc`, action.desc)}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
