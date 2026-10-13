// Invoice template styles and color schemes for Flas CRM business documents.
// Each template customizes primary brand colors, accent banners, typography,
// and table layouts on generated vector PDFs and live previews.

export type InvoiceTemplateStyle = "modern" | "classic" | "executive" | "minimal" | "bold";

export type InvoiceTemplateDefinition = {
  id: string;
  name: string;
  style: InvoiceTemplateStyle;
  primary_color: string;
  accent_color: string;
  secondary_color: string;
  description: string;
  badge: string;
  font_family: string;
  watermark_default: boolean;
};

export const INVOICE_TEMPLATES: InvoiceTemplateDefinition[] = [
  {
    id: "modern-emerald",
    name: "Modern Emerald",
    style: "modern",
    primary_color: "#0F5132",
    accent_color: "#16A34A",
    secondary_color: "#111827",
    description:
      "Crisp contemporary styling with emerald header accents, clean dividers, and balanced spacing.",
    badge: "Default",
    font_family: "Helvetica",
    watermark_default: true,
  },
  {
    id: "corporate-navy",
    name: "Corporate Navy",
    style: "classic",
    primary_color: "#1E3A8A",
    accent_color: "#3B82F6",
    secondary_color: "#0F172A",
    description:
      "Authoritative deep navy theme with formal borders, structured item tables, and executive totals.",
    badge: "Professional",
    font_family: "Helvetica",
    watermark_default: true,
  },
  {
    id: "executive-slate",
    name: "Executive Slate",
    style: "executive",
    primary_color: "#334155",
    accent_color: "#64748B",
    secondary_color: "#1E293B",
    description:
      "Understated architectural slate palette with high-contrast hierarchy and subtle dividers.",
    badge: "Corporate",
    font_family: "Helvetica",
    watermark_default: true,
  },
  {
    id: "clean-minimal",
    name: "Clean Minimal",
    style: "minimal",
    primary_color: "#18181B",
    accent_color: "#71717A",
    secondary_color: "#27272A",
    description:
      "Monochrome minimalism emphasizing white space, legible line items, and clear figures.",
    badge: "Minimalist",
    font_family: "Helvetica",
    watermark_default: false,
  },
  {
    id: "bold-crimson",
    name: "Bold Crimson",
    style: "bold",
    primary_color: "#991B1B",
    accent_color: "#EF4444",
    secondary_color: "#450A0A",
    description:
      "Energetic crimson accents with prominent callouts for high-visibility trade and commercial billing.",
    badge: "Standout",
    font_family: "Helvetica",
    watermark_default: true,
  },
];

export function getInvoiceTemplate(idOrStyle?: string | null): InvoiceTemplateDefinition {
  const fallback = INVOICE_TEMPLATES[0] as InvoiceTemplateDefinition;
  if (!idOrStyle) return fallback;
  const found =
    INVOICE_TEMPLATES.find((t) => t.id === idOrStyle) ||
    INVOICE_TEMPLATES.find((t) => t.style === idOrStyle);
  return found ?? fallback;
}
