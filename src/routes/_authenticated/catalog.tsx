import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTenant } from "@/hooks/useTenant";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney } from "@/lib/billing-math";
import { productFormError } from "@/lib/form-validation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Package, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/catalog")({
  head: () => ({
    meta: [
      { title: "Product Catalog — Flas CRM" },
      {
        name: "description",
        content:
          "Manage your product catalog with SKUs, pricing, specifications and images for every workspace.",
      },
      { property: "og:title", content: "Product Catalog — Flas CRM" },
      {
        property: "og:description",
        content: "SKUs, pricing, specs and images for the products you pitch and sell.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CatalogPage,
});

type Product = {
  id: string;
  title: string;
  sku: string | null;
  price: number | null;
  description: string | null;
  images: string[];
  specs: Record<string, unknown>;
  created_at: string;
};

/** The solution category stored in a product's free-form specs, if any. */
function productCategory(product: Product): string | null {
  const value = product.specs["category"];
  return typeof value === "string" ? value : null;
}

/**
 * The page a product was imported from, only when it is an ordinary web
 * address. specs are free-form, and a stored `javascript:` URL would run in
 * the admin's session when the link is clicked.
 */
function productSourceUrl(product: Product): string | null {
  const value = product.specs["source_url"];
  return typeof value === "string" && /^https?:\/\//i.test(value) ? value : null;
}

const CATALOG_CATEGORIES = [
  "CCTV & Surveillance",
  "Security Scanners",
  "Cash Counting Machines",
  "Walkie-Talkies",
  "Access Control & Attendance",
  "POS & Barcode Systems",
  "Networking & IT",
  "Gates & Vehicle Security",
  "PBX & Intercom",
  "Alarm, Fire & Public Address",
] as const;

const emptyForm = {
  title: "",
  sku: "",
  price: "",
  description: "",
  image: "",
  category: "",
  sourceUrl: "",
};

function CatalogPage() {
  const qc = useQueryClient();
  // Prices are shown in the workspace currency; a bare number sat next to the
  // SKU badge and read as one value, e.g. "31390 368".
  const { tenant } = useTenant();
  const [form, setForm] = useState(emptyForm);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, title, sku, price, description, images, specs, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Product[];
    },
  });

  const createProduct = useMutation({
    mutationFn: async () => {
      // Checked again here: the button is one guard, not the only one.
      const invalid = productFormError(form);
      if (invalid) throw new Error(invalid);
      const { error } = await supabase.from("products").insert({
        title: form.title.trim(),
        sku: form.sku.trim() || null,
        price: form.price ? Number(form.price) : null,
        description: form.description.trim() || null,
        images: form.image.trim() ? [form.image.trim()] : [],
        specs: {
          ...(form.category ? { category: form.category } : {}),
          ...(form.sourceUrl.trim() ? { source_url: form.sourceUrl.trim() } : {}),
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setForm(emptyForm);
      void qc.invalidateQueries({ queryKey: ["products"] });
      toast.success("Product added to the catalog");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const visibleProducts = products.filter(
    (product) => categoryFilter === "all" || productCategory(product) === categoryFilter,
  );

  const removeProduct = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["products"] });
      toast.success("Product removed");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <main className="flex-1 space-y-6 p-6">
      <header>
        <h1 className="text-[1.75rem] font-bold leading-tight sm:text-3xl">Product Catalog</h1>
        <p className="text-sm text-muted-foreground">
          The products your team quotes, pitches and attaches to portfolio outreach.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Product categories</CardTitle>
          <CardDescription>
            Keep equipment in the same groups customers use when they ask for a solution.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={categoryFilter === "all" ? "default" : "outline"}
            onClick={() => setCategoryFilter("all")}
          >
            All ({products.length})
          </Button>
          {CATALOG_CATEGORIES.map((category) => {
            const count = products.filter(
              (product) => productCategory(product) === category,
            ).length;
            return (
              <Button
                key={category}
                size="sm"
                variant={categoryFilter === category ? "default" : "outline"}
                onClick={() => setCategoryFilter(category)}
              >
                {category} ({count})
              </Button>
            );
          })}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add a product</CardTitle>
            <CardDescription>Title is required, everything else is optional.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-title">Title</Label>
              <Input
                id="p-title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Industrial LED floodlight"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="p-sku">SKU</Label>
                <Input
                  id="p-sku"
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  placeholder="FL-200W"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-price">Price</Label>
                <Input
                  id="p-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  placeholder="249.00"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-category">Category</Label>
              <select
                id="p-category"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="">Choose a category</option>
                {CATALOG_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-image">Image URL</Label>
              <Input
                id="p-image"
                value={form.image}
                onChange={(e) => setForm({ ...form, image: e.target.value })}
                placeholder="https://…"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-desc">Description</Label>
              <Textarea
                id="p-desc"
                rows={4}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Short selling description used by the AI assistant."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-source">Website source page</Label>
              <Input
                id="p-source"
                value={form.sourceUrl}
                onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
                placeholder="https://your-site.com/product/..."
              />
              <p className="text-xs text-muted-foreground">
                Optional. Save the original product page so the team can verify specifications
                before quoting.
              </p>
            </div>
            <Button
              className="w-full gap-2"
              disabled={productFormError(form) !== null || createProduct.isPending}
              onClick={() => createProduct.mutate()}
            >
              <Plus className="size-4" />
              Add product
            </Button>
            {productFormError(form) ? (
              <p className="text-xs text-destructive">{productFormError(form)}</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Catalog</CardTitle>
            <CardDescription>
              {visibleProducts.length} product(s)
              {categoryFilter !== "all" ? ` in ${categoryFilter}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading && <p className="text-sm text-muted-foreground">Loading catalog…</p>}
            {!isLoading && visibleProducts.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No products yet. Add your first one to start building portfolio pitches.
              </p>
            )}
            {visibleProducts.map((product) => (
              <div
                key={product.id}
                className="flex items-start gap-3 rounded-lg border p-3 text-sm"
              >
                {product.images[0] ? (
                  <img
                    src={product.images[0]}
                    alt={product.title}
                    loading="lazy"
                    className="size-14 shrink-0 rounded-md object-cover"
                  />
                ) : (
                  <span className="grid size-14 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                    <Package className="size-5" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{product.title}</p>
                    {product.sku && <Badge variant="outline">{product.sku}</Badge>}
                    {productCategory(product) && (
                      <Badge variant="outline">{productCategory(product)}</Badge>
                    )}
                    {product.price !== null && (
                      <Badge variant="secondary">
                        {formatMoney(product.price, tenant?.currency ?? "AED")}
                      </Badge>
                    )}
                  </div>
                  {product.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {product.description}
                    </p>
                  )}
                  {productSourceUrl(product) && (
                    <a
                      href={productSourceUrl(product) ?? undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 block truncate text-xs text-primary underline"
                    >
                      View source page
                    </a>
                  )}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Delete ${product.title}`}
                  onClick={() => removeProduct.mutate(product.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
