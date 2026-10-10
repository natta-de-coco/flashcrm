// Itemised builder for quotations and invoices. Totals shown here are a live
// preview only — the server recomputes every figure before saving.
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { todayInTimeZone } from "@/lib/locale";
import { Plus, Trash2 } from "lucide-react";
import { useMemo } from "react";

export type BuilderItem = {
  product_id: string | null;
  name: string;
  sku: string | null;
  description: string | null;
  quantity: number;
  unit: string | null;
  unit_price: number;
  discount_value: number;
  discount_type: "percent" | "fixed";
  tax_rate: number;
};

export type BuilderState = {
  id: string | null;
  kind: "quotation" | "invoice";
  contact_id: string | null;
  customer: {
    name: string;
    company: string;
    email: string;
    phone: string;
    address: string;
    vat_number: string;
  };
  issue_date: string;
  due_date: string;
  valid_until: string;
  currency: string;
  payment_terms: string;
  reference: string;
  po_number: string;
  invoice_discount: number;
  shipping: number;
  additional_charges: number;
  adjustment: number;
  notes: string;
  terms: string;
  items: BuilderItem[];
};

export function emptyItem(): BuilderItem {
  return {
    product_id: null,
    name: "",
    sku: null,
    description: null,
    quantity: 1,
    unit: null,
    unit_price: 0,
    discount_value: 0,
    discount_type: "percent",
    tax_rate: 0,
  };
}

export function emptyDocument(
  currency: string,
  taxRate: number,
  terms: string,
  timeZone: string | null,
): BuilderState {
  // The tenant's calendar day, not the server's.
  const today = todayInTimeZone(timeZone);
  return {
    id: null,
    kind: "invoice",
    contact_id: null,
    customer: { name: "", company: "", email: "", phone: "", address: "", vat_number: "" },
    issue_date: today,
    due_date: "",
    valid_until: "",
    currency,
    payment_terms: "",
    reference: "",
    po_number: "",
    invoice_discount: 0,
    shipping: 0,
    additional_charges: 0,
    adjustment: 0,
    notes: "",
    terms,
    items: [{ ...emptyItem(), tax_rate: taxRate }],
  };
}

function lineTotals(item: BuilderItem) {
  const gross = item.quantity * item.unit_price;
  const discount =
    item.discount_type === "percent" ? (gross * item.discount_value) / 100 : item.discount_value;
  const net = Math.max(0, gross - discount);
  const tax = (net * item.tax_rate) / 100;
  return { gross, discount, net, tax, total: net + tax };
}

export function previewTotals(state: BuilderState) {
  let subtotal = 0;
  let discountTotal = 0;
  let taxTotal = 0;
  for (const item of state.items) {
    const t = lineTotals(item);
    subtotal += t.gross;
    discountTotal += t.discount;
    taxTotal += t.tax;
  }
  const afterLines = subtotal - discountTotal;
  const invoiceDiscount = Math.min(state.invoice_discount || 0, afterLines);
  const grand =
    afterLines -
    invoiceDiscount +
    taxTotal +
    (state.shipping || 0) +
    (state.additional_charges || 0) +
    (state.adjustment || 0);
  return { subtotal, discountTotal: discountTotal + invoiceDiscount, taxTotal, grand };
}

type Contact = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  company: string | null;
  address?: string | null;
  vat_number?: string | null;
};
type Product = {
  id: string;
  title: string;
  sku: string | null;
  price: number | null;
  description: string | null;
};

export function InvoiceBuilder({
  state,
  onChange,
  contacts,
  products,
}: {
  state: BuilderState;
  onChange: (next: BuilderState) => void;
  contacts: Contact[];
  products: Product[];
}) {
  const totals = useMemo(() => previewTotals(state), [state]);
  const money = (value: number) => `${state.currency} ${value.toFixed(2)}`;

  const patch = (partial: Partial<BuilderState>) => onChange({ ...state, ...partial });
  const patchItem = (index: number, partial: Partial<BuilderItem>) =>
    patch({ items: state.items.map((item, i) => (i === index ? { ...item, ...partial } : item)) });

  const pickContact = (id: string) => {
    const contact = contacts.find((c) => c.id === id);
    if (!contact) return;
    patch({
      contact_id: contact.id,
      customer: {
        ...state.customer,
        name: contact.name,
        company: contact.company ?? "",
        email: contact.email ?? "",
        phone: contact.phone ?? "",
        address: contact.address || state.customer.address,
        vat_number: contact.vat_number || state.customer.vat_number,
      },
    });
  };

  const pickProduct = (index: number, productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    patchItem(index, {
      product_id: product.id,
      name: product.title,
      sku: product.sku,
      description: product.description,
      unit_price: Number(product.price ?? 0),
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Document</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={state.kind} onValueChange={(v) => patch({ kind: v as "invoice" })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="quotation">Quotation</SelectItem>
                <SelectItem value="invoice">Invoice</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Currency</Label>
            <Input
              value={state.currency}
              onChange={(e) => patch({ currency: e.target.value.toUpperCase().slice(0, 6) })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Issue date</Label>
            <Input
              type="date"
              value={state.issue_date}
              onChange={(e) => patch({ issue_date: e.target.value })}
            />
          </div>
          {state.kind === "invoice" ? (
            <div className="space-y-1.5">
              <Label>Due date</Label>
              <Input
                type="date"
                value={state.due_date}
                onChange={(e) => patch({ due_date: e.target.value })}
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Valid until</Label>
              <Input
                type="date"
                value={state.valid_until}
                onChange={(e) => patch({ valid_until: e.target.value })}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Reference</Label>
            <Input value={state.reference} onChange={(e) => patch({ reference: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>PO number</Label>
            <Input value={state.po_number} onChange={(e) => patch({ po_number: e.target.value })} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Payment terms</Label>
            <Input
              value={state.payment_terms}
              placeholder="50% advance, balance on delivery"
              onChange={(e) => patch({ payment_terms: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Customer</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Pick from contacts</Label>
            <Select value={state.contact_id ?? ""} onValueChange={pickContact}>
              <SelectTrigger>
                <SelectValue placeholder="Search your CRM contacts" />
              </SelectTrigger>
              <SelectContent>
                {contacts.map((contact) => (
                  <SelectItem key={contact.id} value={contact.id}>
                    {contact.name}
                    {contact.company ? ` · ${contact.company}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              value={state.customer.name}
              onChange={(e) => patch({ customer: { ...state.customer, name: e.target.value } })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Company</Label>
            <Input
              value={state.customer.company}
              onChange={(e) => patch({ customer: { ...state.customer, company: e.target.value } })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>WhatsApp number</Label>
            <Input
              value={state.customer.phone}
              placeholder="+9715XXXXXXX"
              onChange={(e) => patch({ customer: { ...state.customer, phone: e.target.value } })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input
              value={state.customer.email}
              onChange={(e) => patch({ customer: { ...state.customer, email: e.target.value } })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Address</Label>
            <Input
              value={state.customer.address}
              onChange={(e) => patch({ customer: { ...state.customer, address: e.target.value } })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>VAT / TRN</Label>
            <Input
              value={state.customer.vat_number}
              onChange={(e) =>
                patch({ customer: { ...state.customer, vat_number: e.target.value } })
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Items</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => patch({ items: [...state.items, emptyItem()] })}
          >
            <Plus className="mr-1 h-4 w-4" /> Add line
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {state.items.map((item, index) => {
            const t = lineTotals(item);
            return (
              <div key={index} className="rounded-lg border p-3">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-1.5 lg:col-span-2">
                    <Label>From catalog</Label>
                    <Select
                      value={item.product_id ?? ""}
                      onValueChange={(v) => pickProduct(index, v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Optional — pick a product" />
                      </SelectTrigger>
                      <SelectContent>
                        {products.map((product) => (
                          <SelectItem key={product.id} value={product.id}>
                            {product.title}
                            {product.sku ? ` · ${product.sku}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5 lg:col-span-2">
                    <Label>Description shown on the PDF</Label>
                    <Input
                      value={item.name}
                      placeholder="Item name"
                      onChange={(e) => patchItem(index, { name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Qty</Label>
                    <Input
                      type="number"
                      min={0}
                      value={item.quantity}
                      onChange={(e) => patchItem(index, { quantity: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Unit price</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={item.unit_price}
                      onChange={(e) => patchItem(index, { unit_price: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Discount</Label>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        min={0}
                        value={item.discount_value}
                        onChange={(e) =>
                          patchItem(index, { discount_value: Number(e.target.value) })
                        }
                      />
                      <Select
                        value={item.discount_type}
                        onValueChange={(v) => patchItem(index, { discount_type: v as "percent" })}
                      >
                        <SelectTrigger className="w-20">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="percent">%</SelectItem>
                          <SelectItem value="fixed">Amt</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Tax %</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={item.tax_rate}
                      onChange={(e) => patchItem(index, { tax_rate: Number(e.target.value) })}
                    />
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    Net {money(t.net)} · Tax {money(t.tax)} ·{" "}
                    <span className="font-semibold text-foreground">Line {money(t.total)}</span>
                  </span>
                  {state.items.length > 1 ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => patch({ items: state.items.filter((_, i) => i !== index) })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Totals & notes</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Invoice discount</Label>
              <Input
                type="number"
                min={0}
                value={state.invoice_discount}
                onChange={(e) => patch({ invoice_discount: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Shipping</Label>
              <Input
                type="number"
                min={0}
                value={state.shipping}
                onChange={(e) => patch({ shipping: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Other charges</Label>
              <Input
                type="number"
                min={0}
                value={state.additional_charges}
                onChange={(e) => patch({ additional_charges: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Rounding / adjustment</Label>
              <Input
                type="number"
                value={state.adjustment}
                onChange={(e) => patch({ adjustment: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Notes to customer</Label>
              <Textarea
                rows={2}
                value={state.notes}
                onChange={(e) => patch({ notes: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Terms & conditions</Label>
              <Textarea
                rows={3}
                value={state.terms}
                onChange={(e) => patch({ terms: e.target.value })}
              />
            </div>
          </div>
          <div className="rounded-lg bg-muted/50 p-4 text-sm">
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{money(totals.subtotal)}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Discounts</span>
              <span>-{money(totals.discountTotal)}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Tax</span>
              <span>{money(totals.taxTotal)}</span>
            </div>
            <div className="mt-2 flex justify-between border-t pt-2 text-base font-bold">
              <span>Grand total</span>
              <span>{money(totals.grand)}</span>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Final figures are recalculated on the server when you save, so the PDF always matches
              your records.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
