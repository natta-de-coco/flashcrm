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
import {
  FileText,
  Mail,
  Megaphone,
  MessageSquare,
  Package,
  Plus,
  Sparkles,
  UserPlus,
} from "lucide-react";

/**
 * "+ Create" menu. Every entry lands on a real working flow — no dead
 * options — so the header shortcut always does something useful.
 */
const ACTIONS = [
  { label: "Lead", desc: "Capture or import leads", to: "/marketing", icon: UserPlus },
  { label: "Contact", desc: "Add a person to the CRM", to: "/contacts", icon: UserPlus },
  { label: "Message", desc: "Open a conversation", to: "/inbox", icon: MessageSquare },
  { label: "Campaign", desc: "Email or WhatsApp campaign", to: "/marketing", icon: Mail },
  { label: "Social post", desc: "Draft and schedule", to: "/social", icon: Megaphone },
  { label: "SEO article", desc: "Image-to-post studio", to: "/seo-blog/studio", icon: Sparkles },
  { label: "Product", desc: "Add to your catalog", to: "/catalog", icon: Package },
  { label: "Content draft", desc: "Posts & articles", to: "/content", icon: FileText },
] as const;

export function QuickCreate({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact ? (
          <Button size="icon" aria-label="Create" className="size-9 shrink-0">
            <Plus className="size-4" />
          </Button>
        ) : (
          <Button className="gap-1.5">
            <Plus className="size-4" />
            Create
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Create</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {ACTIONS.map((action) => (
          <DropdownMenuItem
            key={action.label}
            onSelect={() => void navigate({ to: action.to })}
            className="gap-2.5"
          >
            <action.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block text-sm font-medium leading-tight">{action.label}</span>
              <span className="block truncate text-xs text-muted-foreground">{action.desc}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
