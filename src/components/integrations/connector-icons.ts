// One icon and brand tint per connector, so every surface that lists them
// looks like the same product. Previously the connector cards showed no icon
// at all while /social kept its own private icon table — two lists of the same
// platforms that could drift apart.
import type { ConnectorId } from "@/lib/connections-catalog";
import {
  AtSign,
  BarChart3,
  Facebook,
  Globe,
  Instagram,
  Linkedin,
  type LucideIcon,
  MapPin,
  Megaphone,
  MessageCircle,
  Music2,
  Search,
  ShoppingBag,
  Store,
  Twitter,
  Youtube,
} from "lucide-react";

type IconSpec = { icon: LucideIcon; tint: string };

/** Tints are deliberately muted: the card is a control, not a logo wall. */
const ICONS: Record<string, IconSpec> = {
  instagram: { icon: Instagram, tint: "text-pink-600 dark:text-pink-400" },
  facebook: { icon: Facebook, tint: "text-blue-600 dark:text-blue-400" },
  threads: { icon: AtSign, tint: "text-foreground" },
  linkedin: { icon: Linkedin, tint: "text-sky-700 dark:text-sky-400" },
  tiktok: { icon: Music2, tint: "text-foreground" },
  youtube: { icon: Youtube, tint: "text-red-600 dark:text-red-400" },
  twitter: { icon: Twitter, tint: "text-foreground" },
  pinterest: { icon: Store, tint: "text-red-700 dark:text-red-400" },
  google_business: { icon: MapPin, tint: "text-emerald-600 dark:text-emerald-400" },
  whatsapp: { icon: MessageCircle, tint: "text-green-600 dark:text-green-400" },
  meta_ads: { icon: Megaphone, tint: "text-blue-600 dark:text-blue-400" },
  google_ads: { icon: Megaphone, tint: "text-amber-600 dark:text-amber-400" },
  linkedin_ads: { icon: Megaphone, tint: "text-sky-700 dark:text-sky-400" },
  tiktok_ads: { icon: Megaphone, tint: "text-foreground" },
  google_analytics: { icon: BarChart3, tint: "text-orange-600 dark:text-orange-400" },
  search_console: { icon: Search, tint: "text-blue-600 dark:text-blue-400" },
  wordpress: { icon: Globe, tint: "text-sky-700 dark:text-sky-400" },
  shopify: { icon: ShoppingBag, tint: "text-emerald-600 dark:text-emerald-400" },
  woocommerce: { icon: ShoppingBag, tint: "text-purple-600 dark:text-purple-400" },
};

export function connectorIcon(id: ConnectorId | string): IconSpec {
  return ICONS[id] ?? { icon: Globe, tint: "text-muted-foreground" };
}
