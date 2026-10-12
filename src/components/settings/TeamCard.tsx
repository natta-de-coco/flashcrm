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
import { useI18n } from "@/hooks/useI18n";
import { hasMessage } from "@/lib/i18n";
import {
  INVITE_TTL_DAYS,
  inviteStaff,
  listTeam,
  removeStaff,
  setStaffRole,
} from "@/lib/onboarding.functions";
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
  const { t } = useI18n();
  const qc = useQueryClient();
  // Role names and what each grants, in the reader's language; an unknown
  // role falls back to the English label, then to its id.
  const roleText = (r: string, part: "label" | "hint") => {
    const key = `role.${r}.${part}`;
    return hasMessage(key) ? t(key) : (ROLE_LABELS[r as AssignableRole]?.[part] ?? r);
  };
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
      toast.success(t("settings.team.invited", { email: email.trim() }));
      setEmail("");
      refresh();
    },
    onError: fail,
  });

  const updateRole = useMutation({
    mutationFn: (v: { userId: string; staffRole: AssignableRole }) => changeRole({ data: v }),
    onSuccess: () => {
      toast.success(t("settings.team.roleUpdated"));
      refresh();
    },
    onError: fail,
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => remove({ data: { userId } }),
    onSuccess: () => {
      toast.success(t("settings.team.removed"));
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
          {t("settings.team.title")}
          <Badge variant="secondary">{members.length}</Badge>
        </CardTitle>
        <CardDescription>
          {canManage ? t("settings.team.descManage") : t("settings.team.descView")}
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4">
        {canManage && (
          <div className="grid gap-3 rounded-lg border border-dashed p-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
              <div className="grid gap-1.5">
                <Label htmlFor="invite_email">{t("settings.team.inviteEmail")}</Label>
                <Input
                  id="invite_email"
                  type="email"
                  placeholder="teammate@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="invite_role">{t("settings.team.role")}</Label>
                <Select value={role} onValueChange={(v) => setRole(v as AssignableRole)}>
                  <SelectTrigger id="invite_role" className="w-full sm:w-52">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSIGNABLE.map((r) => (
                      <SelectItem key={r} value={r}>
                        {roleText(r, "label")}
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
                <Mail className="size-3.5" /> {t("settings.team.sendInvite")}
              </Button>
            </div>
            {/* What the chosen role actually grants, said before it is granted. */}
            <p className="text-xs text-muted-foreground">
              <ShieldCheck className="me-1 inline size-3.5 align-[-2px]" />
              {roleText(role, "hint")}{" "}
              <span className="text-muted-foreground/70">
                {t("settings.team.sees", { count: routesFor(role).length, total: 15 })}
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
                  {isMe ? ` ${t("settings.team.you")}` : ""}
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
                    <SelectTrigger
                      className="w-44"
                      aria-label={t("settings.team.roleFor", { email: m.email ?? "" })}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ASSIGNABLE.map((r) => (
                        <SelectItem key={r} value={r}>
                          {roleText(r, "label")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("settings.team.remove", { email: m.email ?? "" })}
                    disabled={removeMember.isPending}
                    onClick={() => removeMember.mutate(m.id)}
                  >
                    <UserMinus className="size-4" />
                  </Button>
                </div>
              ) : (
                <Badge variant="secondary">{roleText(m.staff_role, "label")}</Badge>
              )}
            </div>
          );
        })}

        {invites.length > 0 && (
          <div className="grid gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("settings.team.pending")}
            </p>
            <p className="-mt-1 text-xs text-muted-foreground">
              {t("settings.team.pendingHelp", { days: INVITE_TTL_DAYS })}
            </p>
            {invites.map((i) => (
              <div
                key={i.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-dashed p-3"
              >
                <p className="truncate text-sm">{i.email}</p>
                <Badge variant="outline">
                  {roleText(i.staff_role, "label")} ·{" "}
                  {(() => {
                    const left =
                      INVITE_TTL_DAYS -
                      Math.floor((Date.now() - new Date(i.created_at).getTime()) / 86_400_000);
                    return left <= 1
                      ? t("settings.team.expiresToday")
                      : t("settings.team.daysLeft", { count: left });
                  })()}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
