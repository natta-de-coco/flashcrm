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
import { recordAuditEvent } from "@/lib/audit.functions";
import { parseContactImport, validRows } from "@/lib/contact-import";
import { STAGES, type Contact, type LeadStage } from "@/lib/crm-types";
import { downloadCsv, toCsv } from "@/lib/csv";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircle, Download, Plus, Search, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/contacts")({
  head: () => ({
    meta: [
      { title: "Contacts & Leads — Flash CRM" },
      {
        name: "description",
        content: "Track every WhatsApp lead through your sales pipeline stages.",
      },
      { property: "og:title", content: "Contacts & Leads — Flash CRM" },
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
  const auditEvent = useServerFn(recordAuditEvent);

  // Live validation: every parsed row carries its own error list.
  const previewRows = useMemo(
    () => (importText.trim() ? parseContactImport(importText) : []),
    [importText],
  );
  const importableRows = useMemo(() => validRows(previewRows), [previewRows]);

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

  function exportContacts() {
    const rows = (contacts.data ?? []).map((c) => ({
      name: c.name,
      phone: c.phone,
      email: c.email,
      company: c.company,
      stage: c.stage,
      value: c.value,
      tags: (c.tags ?? []).join("|"),
      consent_given: c.consent_given ? "yes" : "no",
      consent_at: c.consent_at ?? "",
      created_at: c.created_at,
    }));
    downloadCsv(
      `flas-contacts-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(rows as unknown as Record<string, unknown>[], [
        { key: "name", label: "Name" },
        { key: "phone", label: "WhatsApp number" },
        { key: "email", label: "Email" },
        { key: "company", label: "Company" },
        { key: "stage", label: "Pipeline stage" },
        { key: "value", label: "Deal value" },
        { key: "tags", label: "Tags" },
        { key: "consent_given", label: "Consent given" },
        { key: "consent_at", label: "Consent date" },
        { key: "created_at", label: "Added on" },
      ]),
    );
    void auditEvent({
      data: { action: "contacts.export", entityType: "contact", details: { rows: rows.length } },
    }).catch(() => {});
    toast.success("Contacts CSV downloaded");
  }

  const bulkImport = useMutation({
    mutationFn: async () => {
      const rows = importableRows.map((r) => ({
        name: r.name || r.phone || r.email || "",
        phone: r.phone,
        email: r.email,
      }));
      if (rows.length === 0) throw new Error("No valid rows to import — fix the errors below");

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
      void auditEvent({
        data: {
          action: "contacts.import",
          entityType: "contact",
          details: {
            added: result.added,
            skipped: result.skipped,
            invalidRows: previewRows.length - importableRows.length,
          },
        },
      }).catch(() => {});
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
          <Button
            variant="outline"
            onClick={exportContacts}
            disabled={(contacts.data ?? []).length === 0}
          >
            <Download className="size-4" /> Export CSV
          </Button>
          <Dialog open={importOpen} onOpenChange={setImportOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Upload className="size-4" /> Import numbers
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Import leads & numbers</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                Paste one contact per line — a phone number alone, or{" "}
                <code className="rounded bg-muted px-1">name, phone, email</code>. Duplicates are
                skipped automatically and every import is tagged{" "}
                <code className="rounded bg-muted px-1">imported</code> so you can filter the
                records later.
              </p>
              <div className="grid gap-1.5">
                <Label htmlFor="csv_file">…or upload a CSV file</Label>
                <Input
                  id="csv_file"
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) setImportText(await file.text());
                  }}
                />
              </div>
              <Textarea
                rows={6}
                placeholder={"+971501234567\nSara Ahmed, +971559876543, sara@example.com"}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
              />

              {previewRows.length > 0 && (
                <div className="rounded-lg border">
                  <div className="flex items-center justify-between border-b bg-muted/50 px-3 py-2 text-xs font-medium">
                    <span>Preview — check rows before importing</span>
                    <span>
                      {importableRows.length} valid · {previewRows.length - importableRows.length}{" "}
                      with errors
                    </span>
                  </div>
                  <div className="max-h-56 overflow-y-auto">
                    {previewRows.map((row) => (
                      <div
                        key={row.line}
                        className={`flex items-start gap-2 border-b px-3 py-1.5 text-xs last:border-0 ${
                          row.errors.length ? "bg-destructive/5" : ""
                        }`}
                      >
                        <span className="w-8 shrink-0 text-muted-foreground">#{row.line}</span>
                        <span className="min-w-0 flex-1 truncate">
                          {row.name || "—"}
                          {row.phone ? ` · ${row.phone}` : ""}
                          {row.email ? ` · ${row.email}` : ""}
                        </span>
                        {row.errors.length > 0 && (
                          <span className="flex items-center gap-1 text-destructive">
                            <AlertCircle className="size-3 shrink-0" />
                            {row.errors.join("; ")}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <DialogFooter>
                <Button
                  onClick={() => bulkImport.mutate()}
                  disabled={importableRows.length === 0 || bulkImport.isPending}
                >
                  Import {importableRows.length > 0 ? `${importableRows.length} valid ` : ""}
                  contact{importableRows.length === 1 ? "" : "s"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
                        {c.consent_given && (
                          <Badge variant="outline" className="mt-1 text-[10px]">
                            Consented
                            {c.consent_at
                              ? ` · ${new Date(c.consent_at).toLocaleDateString()}`
                              : ""}
                          </Badge>
                        )}
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
