import { ContactDetailDialog } from "@/components/contacts/ContactDetailDialog";
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
import { formatStageMoney, stageTotal } from "@/lib/contacts-view";
import { STAGES, type Contact, type LeadStage } from "@/lib/crm-types";
import { useTenant } from "@/hooks/useTenant";
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

const EMPTY = {
  name: "",
  phone: "",
  email: "",
  company: "",
  value: "0",
  notes: "",
  consent: false,
};

const E164 = /^\+[1-9][0-9]{7,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ContactsPage() {
  const qc = useQueryClient();
  const { tenant } = useTenant();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [detailFor, setDetailFor] = useState<{ id: string; name: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importConsent, setImportConsent] = useState(false);
  const auditEvent = useServerFn(recordAuditEvent);

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

  const contactProblem: string | null = (() => {
    if (form.name.trim().length < 2) return "Enter a name.";
    const phone = form.phone.trim();
    const email = form.email.trim();
    if (!phone && !email) return "Add a WhatsApp number or an email.";
    if (phone && !E164.test(phone)) {
      return "Use international E.164 format, for example +971501234567.";
    }
    if (email && !EMAIL.test(email)) return "That email does not look right.";
    if (form.value.trim() && !(Number(form.value) >= 0)) {
      return "Deal value must be a positive number.";
    }
    return null;
  })();

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("contacts").insert({
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        company: form.company.trim() || null,
        value: Number(form.value) || 0,
        notes: form.notes.trim() || null,
        consent_given: form.consent,
        consent_at: form.consent ? new Date().toISOString() : null,
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

  const grantConsent = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("contacts")
        .update({ consent_given: true, consent_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      await auditEvent({
        data: { action: "contact.consent_recorded", entityType: "contact", entityId: id },
      }).catch(() => undefined);
    },
    onSuccess: () => {
      toast.success("Consent recorded — you can message this contact now.");
      void qc.invalidateQueries({ queryKey: ["contacts"] });
    },
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

      const consentAt = importConsent ? new Date().toISOString() : null;
      const { error } = await supabase.from("contacts").insert(
        fresh.map((r) => ({
          ...r,
          tags: ["imported"],
          consent_given: importConsent,
          consent_at: consentAt,
        })),
      );
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
          <h1 className="text-[1.75rem] font-bold leading-tight sm:text-3xl">Contacts & leads</h1>
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

              <label
                htmlFor="import-consent"
                className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-3"
              >
                <input
                  id="import-consent"
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-[hsl(var(--brand))]"
                  checked={importConsent}
                  onChange={(e) => setImportConsent(e.target.checked)}
                />
                <span className="text-sm">
                  <span className="font-medium">Everyone in this list agreed to be contacted.</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Leave unticked if you're not sure — you can record consent per contact later.
                    Without it, these contacts can be stored but not messaged.
                  </span>
                </span>
              </label>

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
                    ["name", "Name", "text", true],
                    ["phone", "WhatsApp number", "tel", false],
                    ["email", "Email", "email", false],
                    ["company", "Company", "text", false],
                    ["value", "Deal value", "number", false],
                  ] as const
                ).map(([key, label, type, required]) => (
                  <div key={key} className="grid gap-1.5">
                    <Label htmlFor={key}>
                      {label}
                      {required && <span className="ml-0.5 text-destructive">*</span>}
                    </Label>
                    <Input
                      id={key}
                      type={type}
                      {...(type === "number" ? { min: 0, step: "0.01" } : {})}
                      {...(key === "phone"
                        ? {
                            placeholder: "+971501234567",
                            pattern: "^\\+[1-9][0-9]{7,14}$",
                            inputMode: "tel" as const,
                            "aria-describedby": "phone-hint",
                          }
                        : {})}
                      {...(required ? { required: true, "aria-required": true } : {})}
                      value={form[key]}
                      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    />
                    {key === "phone" && (
                      <p id="phone-hint" className="text-xs text-muted-foreground">
                        Use international E.164 format with country code, for example +971501234567.
                      </p>
                    )}
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
                <label
                  htmlFor="consent"
                  className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-3"
                >
                  <input
                    id="consent"
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 accent-[hsl(var(--brand))]"
                    checked={form.consent}
                    onChange={(e) => setForm({ ...form, consent: e.target.checked })}
                  />
                  <span className="text-sm">
                    <span className="font-medium">This person agreed to be contacted.</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      Required before you can message them. Tick only if they actually opted in —
                      the date is recorded as your proof of consent.
                    </span>
                  </span>
                </label>
              </div>
              <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
                {contactProblem && (
                  <p className="text-xs text-muted-foreground sm:mr-auto">{contactProblem}</p>
                )}
                <Button
                  onClick={() => create.mutate()}
                  disabled={create.isPending || contactProblem !== null}
                >
                  Save contact
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <ContactDetailDialog
        contactId={detailFor?.id ?? null}
        contactName={detailFor?.name ?? ""}
        onOpenChange={(open) => !open && setDetailFor(null)}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {STAGES.map((stage) => {
          const rows = filtered.filter((c) => c.stage === stage.id);
          // L1: the column showed a card count and nothing else, so the only way
          // to answer "how much is sitting in Negotiation?" was to add the cards
          // up by eye. Totalled over the filtered rows, not all contacts, so the
          // figure always matches the cards actually on screen.
          const { total } = stageTotal(rows, stage.id);
          return (
            <section key={stage.id} className="rounded-xl bg-muted/50 p-3">
              <div className="mb-3 flex items-center justify-between gap-2 px-1">
                <h2 className="text-sm font-semibold">{stage.label}</h2>
                <div className="flex items-center gap-2">
                  {rows.length > 0 && (
                    <span className="text-xs font-semibold text-brand">
                      {formatStageMoney(total, tenant?.currency)}
                    </span>
                  )}
                  <Badge variant="secondary" className="text-[10px]">
                    {rows.length}
                  </Badge>
                </div>
              </div>
              <div className="space-y-2">
                {rows.length === 0 && (
                  <p className="px-1 text-xs text-muted-foreground">No contacts here.</p>
                )}
                {rows.map((c) => (
                  <Card key={c.id}>
                    <CardContent className="space-y-2 p-3">
                      <div>
                        {/* H13: the card was not openable at all — only the small
                            "Numbers & branches" link below it was, which nobody
                            found. The name is the button now, so clicking the
                            contact opens the contact. Kept as a button rather
                            than wrapping the whole card, because the card also
                            holds a stage select and a consent action that must
                            stay independently clickable. */}
                        <button
                          type="button"
                          onClick={() => setDetailFor({ id: c.id, name: c.name })}
                          className="text-left text-sm font-semibold underline-offset-2 hover:underline"
                        >
                          {c.name}
                        </button>
                        <p className="text-xs text-muted-foreground">
                          {c.phone ?? c.email ?? "No contact details"}
                          {c.company ? ` · ${c.company}` : ""}
                        </p>
                        <button
                          type="button"
                          onClick={() => setDetailFor({ id: c.id, name: c.name })}
                          className="mt-1 text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        >
                          Open contact
                        </button>
                        {c.consent_given ? (
                          <Badge variant="outline" className="mt-1 text-[10px]">
                            Consented
                            {c.consent_at
                              ? ` · ${new Date(c.consent_at).toLocaleDateString()}`
                              : ""}
                          </Badge>
                        ) : (
                          <button
                            type="button"
                            onClick={() => grantConsent.mutate(c.id)}
                            disabled={grantConsent.isPending}
                            className="mt-1 inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-solid hover:text-foreground"
                            title="You can't message this contact until they've agreed to be contacted."
                          >
                            Can't message — record consent
                          </button>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        {/* Same formatter as the column total, so a card and the
                            heading above it can never disagree about currency
                            or rounding. */}
                        <span className="text-xs font-semibold text-brand">
                          {formatStageMoney(Number(c.value ?? 0), tenant?.currency)}
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
