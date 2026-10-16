import { canOpen } from "./permissions";

const ACTIONS = [
  { id: "inbox", to: "/inbox" },
  { id: "contacts", to: "/contacts" },
  { id: "sales", to: "/sales" },
  { id: "products", to: "/catalog" },
  { id: "social", to: "/social" },
  { id: "articles", to: "/seo-blog/studio" },
  { id: "content", to: "/content" },
] as const;
export type HomeAction = (typeof ACTIONS)[number];
export function homeActionsFor(role: string | null | undefined) {
  return ACTIONS.filter((action) => canOpen(role, action.to));
}
/** Guide from confirmed overview values only; a failed read is never an empty company. */
export function homePriority(
  data: {
    open: number;
    unreadConversations?: number | undefined;
    contacts: number;
    activity: number;
    hasConversations: boolean;
  } | null,
): "unread" | "open" | "new" | "caughtUp" | null {
  if (!data || data.unreadConversations === undefined) return null;
  if ((data.unreadConversations ?? 0) > 0) return "unread";
  if (data.open > 0) return "open";
  if (data.contacts === 0 && data.activity === 0 && !data.hasConversations) return "new";
  return "caughtUp";
}
