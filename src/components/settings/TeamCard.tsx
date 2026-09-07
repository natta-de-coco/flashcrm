import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTenant } from "@/hooks/useTenant";
import { inviteStaff, listTeam, removeStaff, setStaffRole } from "@/lib/onboarding.functions";
import { ROLE_LABELS, isCompanyManager, routesFor } from "@/lib/permissions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Mail, ShieldCheck, UserMinus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type AssignableRole = keyof typeof ROLE_LABELS;
const ASSIGNABLE = Object.keys(ROLE_LABELS) as AssignableRole[];

/**
 * Team & access.
 *
 * inviteStaff, listTeam, setStaffRole and removeStaff have existed as working,
 * audit-logged server functions for some time with no caller: Settings listed
 * teammates read-only, straight from profiles, showing a legacy user_roles
 * badge that had nothing to do with the staff_role that governs access. So a
 * company could see who was on its team but could not decide what any of them
 * could reach. This is that missing screen.
 */
export function TeamCard() {
  const { staffRole } = useTenant();
  const qc = useQueryClient();
  const canManage = isCompanyManager(staffRole);

  const load = useServerFn(listTeam);
  const invite = useServerFn(inviteStaff);
  const changeRole = useServerFn(setStaffRole);
  const remove = useServerFn(removeStaff);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AssignableRole>("staff");

  const team = useQuery({ queryKey: ["team"], queryFn: () => load() });

  const refresh = () => void qc.invalidateQueries({ queryKey: ["team"] });
  const fail = (e: Error) => toast.error(e.message);

  const sendInvite = useMutation({
    mutationFn: () => invite({ data: { email: email.trim(), staffRole: role } }),
    onSuccess: () => {
      toast.success(`Invite created for ${email.trim()}`);
      setEmail("");
      refresh();
    },
    onError: fail,
  });

  const updateRole = useMutation({
    mutationFn: (v: { userId: string; staffRole: AssignableRole }) => changeRole({ data: v }),
    onSuccess: () => {
      toast.success("Role updated");
      refresh();
    },
    onError: fail,
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => remove({ data: { userId } }),
    onSuccess: () => {
      toast.success("Removed from the workspace");
      refresh();
    },
    onError: fail,
  });

  const members = team.data?.members ?? [];
  const invites = team.data?.invites ?? [];
  const myId = team.data?.myId;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          Team and access
          <Badge variant="secondary">{members.length}</Badge>
        </CardTitle>
        <CardDescription>
          {canManage
            ? "Invite teammates and choose what each of them can reach. Roles take effect immediately."
            : "The people in this workspace. Only a company admin can change roles."}
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4">
        {canManage && (
          <div className="grid gap-3 rounded-lg border border-dashed p-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
              <div className="grid gap-1.5">
                <Label htmlFor="invite_email">Invite by email</Label>
                <Input
                  id="invite_email"
                  type="email"
                  placeholder="teammate@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="invite_role">Role</Label>
                <Select value={role} onValueChange={(v) => setRole(v as AssignableRole)}>
                  <SelectTrigger id="invite_role" className="w-full sm:w-52">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSIGNABLE.map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABELS[r].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                disabled={!email.trim() || sendInvite.isPending}
                onClick={() => sendInvite.mutate()}
                className="gap-1.5"
              >
                <Mail className="size-3.5" /> Send invite
              </Button>
            </div>
            {/* What the chosen role actually grants, said before it is granted. */}
            <p className="text-xs text-muted-foreground">
              <ShieldCheck className="mr-1 inline size-3.5 align-[-2px]" />
              {ROLE_LABELS[role].hint}{" "}
              <span className="text-muted-foreground/70">
                Sees {routesFor(role).length} of 15 sections.
              </span>
            </p>
          </div>
        )}

        {members.map((m) => {
          const isMe = m.id === myId;
          const assignable = ASSIGNABLE.includes(m.staff_role as AssignableRole);
          return (
            <div
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {m.full_name || m.email}
                  {isMe ? " (you)" : ""}
                </p>
                <p className="truncate text-xs text-muted-foreground">{m.email}</p>
              </div>

              {canManage && !isMe && assignable ? (
                <div className="flex items-center gap-2">
                  <Select
                    value={m.staff_role}
                    onValueChange={(v) =>
                      updateRole.mutate({ userId: m.id, staffRole: v as AssignableRole })
                    }
                  >
                    <SelectTrigger className="w-44" aria-label={`Role for ${m.email}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ASSIGNABLE.map((r) => (
                        <SelectItem key={r} value={r}>
                          {ROLE_LABELS[r].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${m.email} from the workspace`}
                    disabled={removeMember.isPending}
                    onClick={() => removeMember.mutate(m.id)}
                  >
                    <UserMinus className="size-4" />
                  </Button>
                </div>
              ) : (
                <Badge variant="secondary">
                  {ROLE_LABELS[m.staff_role as AssignableRole]?.label ?? m.staff_role}
                </Badge>
              )}
            </div>
          );
        })}

        {invites.length > 0 && (
          <div className="grid gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Pending invites
            </p>
            {invites.map((i) => (
              <div
                key={i.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-dashed p-3"
              >
                <p className="truncate text-sm">{i.email}</p>
                <Badge variant="outline">
                  {ROLE_LABELS[i.staff_role as AssignableRole]?.label ?? i.staff_role} · pending
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
