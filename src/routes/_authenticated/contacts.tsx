import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { supabase } from "@/integrations/supabase/client";
import { STAGES, type Contact, type LeadStage } from "@/lib/crm-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Search, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/contacts")({
  head: () => ({
    meta: [
      { title: "Contacts & Leads — Flas CRM" },
      {
        name: "description",
        content: "Track every WhatsApp lead through your sales pipeline stages.",
      },
      { property: "og:title", content: "Contacts & Leads — Flas CRM" },
      {
        property: "og:description",
        content: "Track every WhatsApp lead through your sales pipeline stages.",
      },
    ],
  }),
  component: ContactsPage,
});

const EMPTY = { name: "", phone: "", email: "", company: "", value: "0", notes: "" };

function ContactsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");

  const contacts = useQuery({
    queryKey: ["contacts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contacts")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as Contact[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("contacts").insert({
        name: form.name.trim() || "Unnamed contact",
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        company: form.company.trim() || null,
        value: Number(form.value) || 0,
        notes: form.notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setForm(EMPTY);
      setOpen(false);
      toast.success("Contact added");
      void qc.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const move = useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: LeadStage }) => {
      const { error } = await supabase.from("contacts").update({ stage }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["contacts"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkImport = useMutation({
    mutationFn: async () => {
      const rows = importText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [a = "", b = "", c = ""] = line.split(/[,\t;]/).map((p) => p.trim());
          // Accept "phone", "name, phone" or "name, phone, email" per line.
          const phoneish = (v: string) => /^[+0-9][0-9\s()-]{4,}$/.test(v);
          let name = a;
          let phone = b;
          let email = c;
          if (phoneish(a) && !b) {
            name = "";
            phone = a;
          } else if (phoneish(a) && phoneish(b)) {
            name = "";
            phone = a;
            email = b;
          }
          return { name: name || phone, phone: phone || null, email: email || null };
        })
        .filter((r) => r.phone || r.email);

      if (rows.length === 0) throw new Error("No valid numbers or emails found");

      const phones = rows.map((r) => r.phone).filter(Boolean) as string[];
      const { data: existing } = phones.length
        ? await supabase.from("contacts").select("phone").in("phone", phones)
        : { data: [] as { phone: string }[] };
      const known = new Set((existing ?? []).map((e) => e.phone));
      const fresh = rows.filter((r) => !r.phone || !known.has(r.phone));
      if (fresh.length === 0) return { added: 0, skipped: rows.length };

      const { error } = await supabase
        .from("contacts")
        .insert(fresh.map((r) => ({ ...r, tags: ["imported"] })));
      if (error) throw error;
      return { added: fresh.length, skipped: rows.length - fresh.length };
    },
    onSuccess: (result) => {
      setImportText("");
      setImportOpen(false);
      toast.success(
        `Imported ${result.added} contact${result.added === 1 ? "" : "s"}` +
          (result.skipped ? ` · ${result.skipped} already existed` : ""),
      );
      void qc.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (contacts.data ?? []).filter(
      (c) =>
        !q ||
        c.name.toLowerCase().includes(q) ||
        (c.phone ?? "").includes(q) ||
        (c.company ?? "").toLowerCase().includes(q),
    );
  }, [contacts.data, search]);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Contacts & leads</h1>
          <p className="text-sm text-muted-foreground">
            Every WhatsApp and website contact, organised by pipeline stage.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="w-56 pl-9"
              placeholder="Search contacts"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="size-4" /> New contact
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New contact</DialogTitle>
              </DialogHeader>
              <div className="grid gap-3">
                {(
                  [
                    ["name", "Name"],
                    ["phone", "WhatsApp number"],
                    ["email", "Email"],
                    ["company", "Company"],
                    ["value", "Deal value"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="grid gap-1.5">
                    <Label htmlFor={key}>{label}</Label>
                    <Input
                      id={key}
                      value={form[key]}
                      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    />
                  </div>
                ))}
                <div className="grid gap-1.5">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => create.mutate()} disabled={create.isPending}>
                  Save contact
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {STAGES.map((stage) => {
          const rows = filtered.filter((c) => c.stage === stage.id);
          return (
            <section key={stage.id} className="rounded-xl bg-muted/50 p-3">
              <div className="mb-3 flex items-center justify-between px-1">
                <h2 className="text-sm font-semibold">{stage.label}</h2>
                <Badge variant="secondary" className="text-[10px]">
                  {rows.length}
                </Badge>
              </div>
              <div className="space-y-2">
                {rows.length === 0 && (
                  <p className="px-1 text-xs text-muted-foreground">No contacts here.</p>
                )}
                {rows.map((c) => (
                  <Card key={c.id}>
                    <CardContent className="space-y-2 p-3">
                      <div>
                        <p className="text-sm font-semibold">{c.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {c.phone ?? c.email ?? "No contact details"}
                          {c.company ? ` · ${c.company}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-brand">
                          {Number(c.value ?? 0).toLocaleString(undefined, {
                            style: "currency",
                            currency: "USD",
                            maximumFractionDigits: 0,
                          })}
                        </span>
                        <Select
                          value={c.stage}
                          onValueChange={(v) => move.mutate({ id: c.id, stage: v as LeadStage })}
                        >
                          <SelectTrigger className="h-8 w-32 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {STAGES.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
