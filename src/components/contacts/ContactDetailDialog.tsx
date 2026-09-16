// Every way one customer reaches you, and every place they trade from.
//
// The old model held a single phone per contact, so a customer messaging from
// the office landline after using their mobile became a second contact with its
// own thread. This is where the numbers get gathered back onto one record.
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  addContactIdentity,
  getContactDetail,
  removeContactBranch,
  removeContactIdentity,
  saveContactBranch,
  setPrimaryIdentity,
} from "@/lib/contact-identities.functions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Building2, Mail, Phone, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type Props = {
  contactId: string | null;
  contactName: string;
  onOpenChange: (open: boolean) => void;
};

export function ContactDetailDialog({ contactId, contactName, onOpenChange }: Props) {
  const qc = useQueryClient();
  const load = useServerFn(getContactDetail);
  const addIdentity = useServerFn(addContactIdentity);
  const dropIdentity = useServerFn(removeContactIdentity);
  const makePrimary = useServerFn(setPrimaryIdentity);
  const saveBranch = useServerFn(saveContactBranch);
  const dropBranch = useServerFn(removeContactBranch);

  const [kind, setKind] = useState<"phone" | "email">("phone");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [branchName, setBranchName] = useState("");
  const [branchCity, setBranchCity] = useState("");

  const detail = useQuery({
    queryKey: ["contact-detail", contactId],
    queryFn: () => load({ data: { contactId: contactId! } }),
    enabled: Boolean(contactId),
  });

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

  const identities = detail.data?.identities ?? [];
  const branches = detail.data?.branches ?? [];
  const branchName_ = (id: string | null) =>
    id ? (branches.find((b) => b.id === id)?.name ?? null) : null;

  return (
    <Dialog open={Boolean(contactId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{contactName}</DialogTitle>
          <DialogDescription>
            Numbers and branches. Any number listed here reaches this contact — a message from it
            lands in the same conversation instead of creating a duplicate.
          </DialogDescription>
        </DialogHeader>

        {detail.isLoading && <Skeleton className="h-40 w-full" />}

        {!detail.isLoading && (
          <div className="grid gap-6">
            <section className="grid gap-2">
              <h3 className="text-sm font-semibold">Numbers &amp; emails</h3>
              {identities.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nothing recorded yet. Add the numbers this customer messages you from.
                </p>
              )}
              {identities.map((row) => (
                <div key={row.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                  {row.kind === "phone" ? (
                    <Phone className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <Mail className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{row.value}</span>
                  {row.label && (
                    <Badge variant="outline" className="text-[10px]">
                      {row.label}
                    </Badge>
                  )}
                  {branchName_(row.branch_id) && (
                    <Badge variant="secondary" className="text-[10px]">
                      {branchName_(row.branch_id)}
                    </Badge>
                  )}
                  {row.is_primary ? (
                    <Badge className="gap-1 text-[10px]">
                      <Star className="size-2.5" /> Primary
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      aria-label={`Make ${row.value} the primary ${row.kind}`}
                      disabled={primaryMutation.isPending}
                      onClick={() =>
                        primaryMutation.mutate({
                          id: row.id,
                          kind: row.kind as "phone" | "email",
                        })
                      }
                    >
                      Make primary
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 shrink-0"
                    aria-label={`Remove ${row.value}`}
                    disabled={removeIdentityMutation.isPending}
                    onClick={() => removeIdentityMutation.mutate(row.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
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
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The label shown on a contact card, e.g. "3 numbers · 2 branches". */
export function contactReachSummary(identities: number, branches: number): string {
  const parts: string[] = [];
  if (identities > 0)
    parts.push(`${identities} ${identities === 1 ? "contact point" : "contact points"}`);
  if (branches > 0) parts.push(`${branches} ${branches === 1 ? "branch" : "branches"}`);
  return parts.join(" · ");
}
