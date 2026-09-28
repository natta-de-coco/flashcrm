// One customer, opened: who they are, every way they reach you, every place
// they trade from, and every conversation you have had with them.
//
// The old model held a single phone per contact, so a customer messaging from
// the office landline after using their mobile became a second contact with its
// own thread. This is where the numbers get gathered back onto one record.
//
// Two defects were fixed here. H12: the list read `contact_identities` alone, so
// a contact whose number lives only in `contacts.phone` — which is every contact
// the New contact form or the CSV import has ever created — was described as
// having nothing recorded. H13: a contact card could not be opened into anything
// beyond that list; there was no stage, deal value, tags, notes or route to the
// conversation.
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useTenant } from "@/hooks/useTenant";
import {
  addContactIdentity,
  getContactDetail,
  removeContactBranch,
  removeContactIdentity,
  saveContactBranch,
  saveContactNotes,
  setPrimaryIdentity,
} from "@/lib/contact-identities.functions";
import {
  formatStageMoney,
  inboxConversationHref,
  reachLines,
  reachSummary,
} from "@/lib/contacts-view";
import { STAGES } from "@/lib/crm-types";
import { openContactWhatsApp } from "@/lib/whatsapp-conversations.functions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Building2, Globe, Mail, MessageSquare, Phone, Star, Tag, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type Props = {
  contactId: string | null;
  contactName: string;
  onOpenChange: (open: boolean) => void;
};

export function ContactDetailDialog({ contactId, contactName, onOpenChange }: Props) {
  const qc = useQueryClient();
  const { tenant } = useTenant();
  const navigate = useNavigate();
  const openWhatsApp = useServerFn(openContactWhatsApp);
  const startChat = useMutation({
    mutationFn: () => openWhatsApp({ data: { contactId: contactId! } }),
    onSuccess: async ({ conversationId }) => {
      await qc.invalidateQueries({ queryKey: ["conversations"] });
      onOpenChange(false);
      await navigate({ to: "/inbox", search: { conversation: conversationId } });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const load = useServerFn(getContactDetail);
  const addIdentity = useServerFn(addContactIdentity);
  const dropIdentity = useServerFn(removeContactIdentity);
  const makePrimary = useServerFn(setPrimaryIdentity);
  const saveBranch = useServerFn(saveContactBranch);
  const dropBranch = useServerFn(removeContactBranch);
  const saveNotes = useServerFn(saveContactNotes);

  const [kind, setKind] = useState<"phone" | "email">("phone");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [branchName, setBranchName] = useState("");
  const [branchCity, setBranchCity] = useState("");
  const [notes, setNotes] = useState("");
  const [notesTouched, setNotesTouched] = useState(false);

  const detail = useQuery({
    queryKey: ["contact-detail", contactId],
    queryFn: () => load({ data: { contactId: contactId! } }),
    enabled: Boolean(contactId),
  });

  const contact = detail.data?.contact ?? null;

  // Seed the notes box from the record, but never over something half-typed:
  // the detail query refetches whenever an identity is added, and clobbering an
  // unsaved note on an unrelated save would be its own bug report.
  useEffect(() => {
    if (notesTouched) return;
    setNotes(contact?.notes ?? "");
  }, [contact?.notes, notesTouched]);

  // A fresh contact means a fresh editing state.
  useEffect(() => {
    setNotesTouched(false);
    setNotes("");
  }, [contactId]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["contact-detail", contactId] });
    void qc.invalidateQueries({ queryKey: ["contacts"] });
  };
  const fail = (e: Error) => toast.error(e.message);

  const identityMutation = useMutation({
    mutationFn: () =>
      addIdentity({
        data: {
          contactId: contactId!,
          kind,
          value: value.trim(),
          ...(label.trim() ? { label: label.trim() } : {}),
        },
      }),
    onSuccess: () => {
      setValue("");
      setLabel("");
      toast.success(kind === "phone" ? "Number added" : "Email added");
      refresh();
    },
    onError: fail,
  });

  const branchMutation = useMutation({
    mutationFn: () =>
      saveBranch({
        data: {
          contactId: contactId!,
          name: branchName.trim(),
          ...(branchCity.trim() ? { city: branchCity.trim() } : {}),
        },
      }),
    onSuccess: () => {
      setBranchName("");
      setBranchCity("");
      toast.success("Branch added");
      refresh();
    },
    onError: fail,
  });

  const removeIdentityMutation = useMutation({
    mutationFn: (id: string) => dropIdentity({ data: { id } }),
    onSuccess: refresh,
    onError: fail,
  });
  const primaryMutation = useMutation({
    mutationFn: (v: { id: string; kind: "phone" | "email" }) =>
      makePrimary({ data: { id: v.id, contactId: contactId!, kind: v.kind } }),
    onSuccess: refresh,
    onError: fail,
  });
  const removeBranchMutation = useMutation({
    mutationFn: (id: string) => dropBranch({ data: { id } }),
    onSuccess: refresh,
    onError: fail,
  });
  const notesMutation = useMutation({
    mutationFn: () => saveNotes({ data: { contactId: contactId!, notes } }),
    onSuccess: () => {
      setNotesTouched(false);
      toast.success("Notes saved");
      refresh();
    },
    onError: fail,
  });

  const identities = detail.data?.identities ?? [];
  const branches = detail.data?.branches ?? [];
  const conversations = detail.data?.conversations ?? [];
  // H12: identities plus whatever only the contact row knows about.
  const lines = reachLines(contact ?? {}, identities);
  const branchNameFor = (id: string | null) =>
    id ? (branches.find((b) => b.id === id)?.name ?? null) : null;
  const stageLabel = STAGES.find((s) => s.id === contact?.stage)?.label ?? contact?.stage ?? null;
  const newestConversation = conversations[0] ?? null;

  return (
    <Dialog open={Boolean(contactId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{contact?.name || contactName}</DialogTitle>
          <DialogDescription>
            {contact?.company ? `${contact.company} — ` : ""}
            Any number listed here reaches this contact — a message from it lands in the same
            conversation instead of creating a duplicate.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Button onClick={() => startChat.mutate()} disabled={!contactId || startChat.isPending}>
            {startChat.isPending ? "Opening WhatsApp…" : "Open WhatsApp conversation"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Review your message in the inbox before sending. A new conversation needs an approved
            template.
          </p>
        </div>
        {detail.isLoading && <Skeleton className="h-40 w-full" />}

        {!detail.isLoading && (
          <div className="grid gap-6">
            <section className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {stageLabel && <Badge variant="secondary">{stageLabel}</Badge>}
                <span className="text-sm font-semibold text-brand">
                  {formatStageMoney(Number(contact?.value ?? 0), tenant?.currency)}
                </span>
                <span className="text-xs text-muted-foreground">{reachSummary(lines)}</span>
                {contact?.consent_given ? (
                  <Badge variant="outline" className="text-[10px]">
                    Consented
                    {contact.consent_at
                      ? ` · ${new Date(contact.consent_at).toLocaleDateString()}`
                      : ""}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    No consent recorded — cannot be messaged
                  </Badge>
                )}
              </div>
              {(contact?.tags ?? []).length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Tag className="size-3 shrink-0 text-muted-foreground" />
                  {(contact?.tags ?? []).map((t: string) => (
                    <Badge key={t} variant="outline" className="text-[10px]">
                      {t}
                    </Badge>
                  ))}
                </div>
              )}
              {newestConversation ? (
                <Button asChild size="sm" className="w-fit">
                  {/* A link to the shared inbox, not a composer of its own: one
                      send path means one audit trail and one consent check. */}
                  <a href={inboxConversationHref(newestConversation.id)}>
                    <MessageSquare className="size-4" /> Message in Inbox
                  </a>
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No conversation yet — a thread appears here as soon as this contact messages you.
                </p>
              )}
            </section>

            <Separator />

            <section className="grid gap-2">
              <h3 className="text-sm font-semibold">Numbers &amp; emails</h3>
              {lines.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nothing recorded yet. Add the numbers this customer messages you from.
                </p>
              )}
              {lines.map((row) => (
                <div
                  key={row.id ?? `row:${row.kind}`}
                  className="flex items-center gap-2 rounded-md border p-2 text-sm"
                >
                  {row.kind === "phone" ? (
                    <Phone className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <Mail className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{row.value}</span>
                  {row.label && (
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {row.label}
                    </Badge>
                  )}
                  {branchNameFor(row.branchId) && (
                    <Badge variant="secondary" className="text-[10px]">
                      {branchNameFor(row.branchId)}
                    </Badge>
                  )}
                  {row.isPrimary ? (
                    <Badge className="shrink-0 gap-1 text-[10px]">
                      <Star className="size-2.5" /> Primary
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      aria-label={`Make ${row.value} the primary ${row.kind}`}
                      disabled={primaryMutation.isPending}
                      onClick={() => primaryMutation.mutate({ id: row.id!, kind: row.kind })}
                    >
                      Make primary
                    </Button>
                  )}
                  {/* No id means the line came from contacts.phone/email rather
                      than an identity row, so there is nothing to delete —
                      showing the button would only produce an error. */}
                  {row.id && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 shrink-0"
                      aria-label={`Remove ${row.value}`}
                      disabled={removeIdentityMutation.isPending}
                      onClick={() => removeIdentityMutation.mutate(row.id!)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              ))}

              <div className="grid gap-2 rounded-md border border-dashed p-2 sm:grid-cols-[7rem_1fr_8rem_auto]">
                <Select value={kind} onValueChange={(v) => setKind(v as "phone" | "email")}>
                  <SelectTrigger aria-label="Type" className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="phone">Phone</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  aria-label={kind === "phone" ? "Phone number" : "Email address"}
                  placeholder={kind === "phone" ? "+971 50 000 0000" : "name@company.com"}
                  autoComplete="off"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
                <Input
                  aria-label="Label"
                  placeholder="Office"
                  autoComplete="off"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
                <Button
                  disabled={value.trim().length < 3 || identityMutation.isPending}
                  onClick={() => identityMutation.mutate()}
                >
                  Add
                </Button>
              </div>
            </section>

            <section className="grid gap-2">
              <h3 className="text-sm font-semibold">Conversations</h3>
              {conversations.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No conversations yet with this contact.
                </p>
              )}
              {conversations.map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                  {c.channel === "web" ? (
                    <Globe className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {c.last_message_preview || "No messages yet"}
                    {c.last_message_at ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · {new Date(c.last_message_at).toLocaleDateString()}
                      </span>
                    ) : null}
                  </span>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {c.status}
                  </Badge>
                  {c.unread_count > 0 && (
                    <Badge className="shrink-0 text-[10px]">{c.unread_count}</Badge>
                  )}
                  <Button asChild size="sm" variant="ghost" className="h-7 shrink-0 px-2 text-xs">
                    <a href={inboxConversationHref(c.id)}>Open</a>
                  </Button>
                </div>
              ))}
            </section>

            <section className="grid gap-2">
              <h3 className="text-sm font-semibold">Branches</h3>
              {branches.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No branches. Add one when a customer trades from more than one location.
                </p>
              )}
              {branches.map((b) => (
                <div key={b.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                  <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    {b.name}
                    {b.city ? <span className="text-muted-foreground"> · {b.city}</span> : null}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 shrink-0"
                    aria-label={`Remove branch ${b.name}`}
                    disabled={removeBranchMutation.isPending}
                    onClick={() => removeBranchMutation.mutate(b.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
              <div className="grid gap-2 rounded-md border border-dashed p-2 sm:grid-cols-[1fr_1fr_auto]">
                <Input
                  aria-label="Branch name"
                  placeholder="Deira branch"
                  autoComplete="off"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                />
                <Input
                  aria-label="Branch city"
                  placeholder="Dubai"
                  autoComplete="off"
                  value={branchCity}
                  onChange={(e) => setBranchCity(e.target.value)}
                />
                <Button
                  disabled={branchName.trim().length < 1 || branchMutation.isPending}
                  onClick={() => branchMutation.mutate()}
                >
                  Add branch
                </Button>
              </div>
            </section>

            <section className="grid gap-2">
              <Label htmlFor="contact-notes" className="text-sm font-semibold">
                Notes
              </Label>
              <Textarea
                id="contact-notes"
                rows={4}
                placeholder="What this customer buys, who to ask for, anything the next person needs."
                value={notes}
                onChange={(e) => {
                  setNotesTouched(true);
                  setNotes(e.target.value);
                }}
              />
              <Button
                className="w-fit"
                size="sm"
                disabled={!notesTouched || notesMutation.isPending}
                onClick={() => notesMutation.mutate()}
              >
                Save notes
              </Button>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// contactReachSummary() lived here and was never called by anything. Its
// replacement is reachSummary() in src/lib/contacts-view.ts, which counts the
// lines actually shown — including the ones H12 was hiding — and is testable
// without a renderer.
