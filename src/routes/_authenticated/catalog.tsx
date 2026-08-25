import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Package, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/catalog")({
  head: () => ({
    meta: [
      { title: "Product Catalog — Flash CRM" },
      {
        name: "description",
        content:
          "Manage your product catalog with SKUs, pricing, specifications and images for every workspace.",
      },
      { property: "og:title", content: "Product Catalog — Flash CRM" },
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
  created_at: string;
};

const emptyForm = { title: "", sku: "", price: "", description: "", image: "" };

function CatalogPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState(emptyForm);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, title, sku, price, description, images, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Product[];
    },
  });

  const createProduct = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("products").insert({
        title: form.title.trim(),
        sku: form.sku.trim() || null,
        price: form.price ? Number(form.price) : null,
        description: form.description.trim() || null,
        images: form.image.trim() ? [form.image.trim()] : [],
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
        <h1 className="text-2xl font-bold">Product Catalog</h1>
        <p className="text-sm text-muted-foreground">
          The products your team quotes, pitches and attaches to portfolio outreach.
        </p>
      </header>

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
            <Button
              className="w-full gap-2"
              disabled={!form.title.trim() || createProduct.isPending}
              onClick={() => createProduct.mutate()}
            >
              <Plus className="size-4" />
              Add product
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Catalog</CardTitle>
            <CardDescription>{products.length} product(s)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading && <p className="text-sm text-muted-foreground">Loading catalog…</p>}
            {!isLoading && products.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No products yet. Add your first one to start building portfolio pitches.
              </p>
            )}
            {products.map((product) => (
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
                    {product.price !== null && (
                      <Badge variant="secondary">{product.price.toString()}</Badge>
                    )}
                  </div>
                  {product.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {product.description}
                    </p>
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
