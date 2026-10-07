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
  draftAfterSave,
  formatStageMoney,
  hasUnsavedNotes,
  inboxConversationHref,
  notesFieldValue,
  reachLines,
  type NotesDraft,
} from "@/lib/contacts-view";
import { useI18n } from "@/hooks/useI18n";
import { hasMessage } from "@/lib/i18n";
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
  const { t } = useI18n();
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
  // Only what has been typed and not yet saved. What the box shows is worked
  // out from this and the saved note on every render (notesFieldValue), not
  // copied in by effects: two effects that each wrote the box left it blank
  // when a contact that was already loaded was opened again.
  const [draft, setDraft] = useState<NotesDraft | null>(null);

  const detail = useQuery({
    queryKey: ["contact-detail", contactId],
    queryFn: () => load({ data: { contactId: contactId! } }),
    enabled: Boolean(contactId),
  });

  type Detail = NonNullable<typeof detail.data>;

  const contact = detail.data?.contact ?? null;

  // A fresh contact means nothing typed yet. Safe as an effect now: it only
  // drops the unsaved typing, and the box never depended on it to show the note.
  useEffect(() => {
    setDraft(null);
  }, [contactId]);

  const notes = notesFieldValue(contactId, contact?.notes, draft);
  const notesTouched = hasUnsavedNotes(contactId, draft);
  // The box is only offered for editing once the saved note is on screen. After
  // a failed load it would be empty, looking like "no note yet", and saving
  // from it would replace a note nobody was shown.
  const notesAvailable = Boolean(contact);

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
      toast.success(kind === "phone" ? t("contactCard.numberAdded") : t("contactCard.emailAdded"));
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
      toast.success(t("contactCard.branchAdded"));
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
    // id is null for the number on the contact record, which has no identity row.
    mutationFn: (v: { id: string | null; kind: "phone" | "email" }) =>
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
    // What is sent is what the box held when Save was pressed, and the contact
    // it was typed for. The box stays editable while the request is out, so the
    // answer is judged against that, not against whatever is in the box by then.
    mutationFn: (sent: NotesDraft) =>
      saveNotes({ data: { contactId: sent.contactId, notes: sent.text } }),
    onSuccess: (result, sent) => {
      // Show the note as stored right away, rather than the one from before
      // until a refetch arrives (or for good, if it fails).
      qc.setQueryData<Detail>(["contact-detail", sent.contactId], (old) =>
        old && old.contact ? { ...old, contact: { ...old.contact, notes: result.notes } } : old,
      );
      // Typing done after Save was pressed was not in the request. Clearing it
      // as "saved" put the stored note back over it, losing it; it stays as
      // unsaved typing, with Save offered again.
      setDraft((current) => draftAfterSave(current, sent));
      toast.success(t("contactCard.notesSaved"));
      void qc.invalidateQueries({ queryKey: ["contact-detail", sent.contactId] });
      void qc.invalidateQueries({ queryKey: ["contacts"] });
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
  const stageLabel = contact?.stage
    ? hasMessage(`stage.${contact.stage}`)
      ? t(`stage.${contact.stage}`)
      : contact.stage
    : null;
  // Counted here rather than by reachSummary(), so the words are the reader's.
  const phoneCount = lines.filter((line) => line.kind === "phone").length;
  const emailCount = lines.filter((line) => line.kind === "email").length;
  const reachText = [
    phoneCount === 0
      ? null
      : phoneCount === 1
        ? t("contactCard.reach.phoneOne")
        : t("contactCard.reach.phoneMany", { count: phoneCount }),
    emailCount === 0
      ? null
      : emailCount === 1
        ? t("contactCard.reach.emailOne")
        : t("contactCard.reach.emailMany", { count: emailCount }),
  ]
    .filter(Boolean)
    .join(" · ");
  const newestConversation = conversations[0] ?? null;

  return (
    <Dialog open={Boolean(contactId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{contact?.name || contactName}</DialogTitle>
          <DialogDescription>
            {contact?.company ? `${contact.company} — ` : ""}
            {t("contactCard.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Button onClick={() => startChat.mutate()} disabled={!contactId || startChat.isPending}>
            {startChat.isPending ? t("contactCard.openingWhatsApp") : t("contactCard.openWhatsApp")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("contactCard.reviewNote")}</p>
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
                <span className="text-xs text-muted-foreground">{reachText}</span>
                {contact?.consent_given ? (
                  <Badge variant="outline" className="text-[10px]">
                    {t("contacts.consented")}
                    {contact.consent_at
                      ? ` · ${new Date(contact.consent_at).toLocaleDateString()}`
                      : ""}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    {t("contactCard.noConsent")}
                  </Badge>
                )}
              </div>
              {(contact?.tags ?? []).length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Tag className="size-3 shrink-0 text-muted-foreground" />
                  {(contact?.tags ?? []).map((tag: string) => (
                    <Badge key={tag} variant="outline" className="text-[10px]">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
              {newestConversation ? (
                <Button asChild size="sm" className="w-fit">
                  {/* A link to the shared inbox, not a composer of its own: one
                      send path means one audit trail and one consent check. */}
                  <a href={inboxConversationHref(newestConversation.id)}>
                    <MessageSquare className="size-4" /> {t("contactCard.messageInInbox")}
                  </a>
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t("contactCard.noConversationYet")}
                </p>
              )}
            </section>

            <Separator />

            <section className="grid gap-2">
              <h3 className="text-sm font-semibold">{t("contactCard.numbersEmails")}</h3>
              {lines.length === 0 && (
                <p className="text-xs text-muted-foreground">{t("contactCard.nothingRecorded")}</p>
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
                      {row.fromContactRow
                        ? row.isPrimary
                          ? t("contactCard.primaryOnRecord")
                          : t("contactCard.onRecord")
                        : row.label}
                    </Badge>
                  )}
                  {branchNameFor(row.branchId) && (
                    <Badge variant="secondary" className="text-[10px]">
                      {branchNameFor(row.branchId)}
                    </Badge>
                  )}
                  {row.isPrimary ? (
                    <Badge className="shrink-0 gap-1 text-[10px]">
                      <Star className="size-2.5" /> {t("contactCard.primary")}
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      aria-label={
                        row.kind === "phone"
                          ? t("contactCard.makePrimaryPhone", { value: row.value })
                          : t("contactCard.makePrimaryEmail", { value: row.value })
                      }
                      disabled={primaryMutation.isPending}
                      onClick={() => primaryMutation.mutate({ id: row.id, kind: row.kind })}
                    >
                      {t("contactCard.makePrimary")}
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
                      aria-label={t("contactCard.remove", { value: row.value })}
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
                  <SelectTrigger aria-label={t("contactCard.type")} className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="phone">{t("contactCard.phone")}</SelectItem>
                    <SelectItem value="email">{t("contactCard.email")}</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  aria-label={
                    kind === "phone" ? t("contactCard.phoneNumber") : t("contactCard.emailAddress")
                  }
                  placeholder={kind === "phone" ? "+971 50 000 0000" : "name@company.com"}
                  autoComplete="off"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
                <Input
                  aria-label={t("contactCard.label")}
                  placeholder={t("contactCard.labelPlaceholder")}
                  autoComplete="off"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
                <Button
                  disabled={value.trim().length < 3 || identityMutation.isPending}
                  onClick={() => identityMutation.mutate()}
                >
                  {t("contactCard.add")}
                </Button>
              </div>
            </section>

            <section className="grid gap-2">
              <h3 className="text-sm font-semibold">{t("contactCard.conversations")}</h3>
              {conversations.length === 0 && (
                <p className="text-xs text-muted-foreground">{t("contactCard.noConversations")}</p>
              )}
              {conversations.map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                  {c.channel === "web" ? (
                    <Globe className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {c.last_message_preview || t("contactCard.noMessages")}
                    {c.last_message_at ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · {new Date(c.last_message_at).toLocaleDateString()}
                      </span>
                    ) : null}
                  </span>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {hasMessage(`contactCard.status.${c.status}`)
                      ? t(`contactCard.status.${c.status}`)
                      : c.status}
                  </Badge>
                  {c.unread_count > 0 && (
                    <Badge className="shrink-0 text-[10px]">{c.unread_count}</Badge>
                  )}
                  <Button asChild size="sm" variant="ghost" className="h-7 shrink-0 px-2 text-xs">
                    <a href={inboxConversationHref(c.id)}>{t("contactCard.open")}</a>
                  </Button>
                </div>
              ))}
            </section>

            <section className="grid gap-2">
              <h3 className="text-sm font-semibold">{t("contactCard.branches")}</h3>
              {branches.length === 0 && (
                <p className="text-xs text-muted-foreground">{t("contactCard.noBranches")}</p>
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
                    aria-label={t("contactCard.removeBranch", { name: b.name })}
                    disabled={removeBranchMutation.isPending}
                    onClick={() => removeBranchMutation.mutate(b.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
              <div className="grid gap-2 rounded-md border border-dashed p-2 sm:grid-cols-[1fr_1fr_auto]">
                <Input
                  aria-label={t("contactCard.branchName")}
                  placeholder={t("contactCard.branchNamePlaceholder")}
                  autoComplete="off"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                />
                <Input
                  aria-label={t("contactCard.branchCity")}
                  placeholder={t("contactCard.branchCityPlaceholder")}
                  autoComplete="off"
                  value={branchCity}
                  onChange={(e) => setBranchCity(e.target.value)}
                />
                <Button
                  disabled={branchName.trim().length < 1 || branchMutation.isPending}
                  onClick={() => branchMutation.mutate()}
                >
                  {t("contactCard.addBranch")}
                </Button>
              </div>
            </section>

            <section className="grid gap-2">
              <Label htmlFor="contact-notes" className="text-sm font-semibold">
                {t("contactCard.notes")}
              </Label>
              {!notesAvailable && (
                <p role="alert" className="text-xs text-destructive">
                  {t("contactCard.notesNotLoaded")}
                </p>
              )}
              <Textarea
                id="contact-notes"
                rows={4}
                placeholder={t("contactCard.notesPlaceholder")}
                value={notes}
                disabled={!notesAvailable}
                onChange={(e) => setDraft({ contactId: contactId!, text: e.target.value })}
              />
              <Button
                className="w-fit"
                size="sm"
                disabled={!notesAvailable || !notesTouched || notesMutation.isPending}
                onClick={() => {
                  if (contactId && draft) notesMutation.mutate(draft);
                }}
              >
                {t("contactCard.saveNotes")}
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
