import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listCompanyMembers, setUserSuspended } from "@/lib/companies.functions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, ShieldOff, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Per-user access control inside one company, for the platform manager.
 *
 * Until now the only lever was suspending an entire company: if one agent had
 * to be cut off, everyone lost access. This suspends one person, and the
 * reason is stored so the next manager to look knows why.
 *
 * A platform super admin cannot be suspended here -- a database trigger
 * refuses it, so the button is hidden rather than offered and then rejected.
 */
export function CompanyMembers({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const load = useServerFn(listCompanyMembers);
  const setSuspended = useServerFn(setUserSuspended);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const members = useQuery({
    queryKey: ["manager-members", orgId],
    queryFn: () => load({ data: { orgId } }),
  });

  const toggle = useMutation({
    mutationFn: (v: { userId: string; suspended: boolean; reason?: string }) =>
      setSuspended({ data: v }),
    onSuccess: (_r, v) => {
      toast.success(v.suspended ? "User suspended" : "User restored");
      setReasonFor(null);
      setReason("");
      void qc.invalidateQueries({ queryKey: ["manager-members", orgId] });
      void qc.invalidateQueries({ queryKey: ["manager-subscriptions"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update the user"),
  });

  if (members.isLoading) {
    return (
      <p className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Loading team…
      </p>
    );
  }

  if (members.error) {
    return (
      <p className="py-3 text-xs text-destructive">
        {members.error instanceof Error ? members.error.message : "Could not load the team"}
      </p>
    );
  }

  const rows = members.data ?? [];
  if (rows.length === 0) {
    return <p className="py-3 text-xs text-muted-foreground">No users in this workspace yet.</p>;
  }

  return (
    <div className="mt-3 grid gap-2">
      {rows.map((m) => {
        const locked = m.staff_role === "super_admin";
        const asking = reasonFor === m.id;
        return (
          <div key={m.id} className="rounded-lg border p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {m.full_name || m.email}
                  {m.suspended && (
                    <Badge variant="destructive" className="ms-2 align-middle text-[10px]">
                      suspended
                    </Badge>
                  )}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {m.email} · {m.staff_role.replace(/_/g, " ")}
                  {m.suspended && m.suspended_reason ? ` · ${m.suspended_reason}` : ""}
                </p>
              </div>

              {locked ? (
                <Badge variant="outline" className="text-[10px]">
                  platform admin
                </Badge>
              ) : m.suspended ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 text-xs"
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate({ userId: m.id, suspended: false })}
                >
                  <ShieldCheck className="size-3" /> Restore
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
                  onClick={() => {
                    setReasonFor(asking ? null : m.id);
                    setReason("");
                  }}
                >
                  <ShieldOff className="size-3" /> Suspend
                </Button>
              )}
            </div>

            {asking && (
              <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
                <Input
                  autoFocus
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason (shown to other managers)"
                  aria-label={`Reason for suspending ${m.email}`}
                  className="h-8 flex-1 text-xs"
                />
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-8 text-xs"
                  disabled={toggle.isPending}
                  onClick={() =>
                    toggle.mutate({
                      userId: m.id,
                      suspended: true,
                      ...(reason.trim() ? { reason: reason.trim() } : {}),
                    })
                  }
                >
                  Confirm suspend
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs"
                  onClick={() => setReasonFor(null)}
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
