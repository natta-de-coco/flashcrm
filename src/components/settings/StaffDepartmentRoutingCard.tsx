import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Users, Plus, Trash2, Send, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/hooks/useI18n";
import { useTenant } from "@/hooks/useTenant";
import { toast } from "sonner";
import {
  getStaffRoutingDirectory,
  saveStaffRoutingNumber,
  deleteStaffRoutingNumber,
  toggleStaffRoutingStatus,
  saveStaffAlertConfig,
  sendTestStaffAlert,
  DEFAULT_STAFF_ALERT_TEMPLATE,
  substituteStaffAlertTags,
} from "@/lib/staff-routing.functions";
import { STAFF_DEPARTMENTS, type StaffDepartment } from "@/lib/staff-alert-template";

export function StaffDepartmentRoutingCard() {
  const { tenant, staffRole } = useTenant();
  const { t } = useI18n();
  if (!tenant || !["company_admin", "super_admin"].includes(staffRole ?? ""))
    return <p className="text-sm text-muted-foreground">{t("staffRouting.adminOnly")}</p>;
  // Switching workspace remounts every tenant-bound draft and send lock.
  return <StaffRoutingEditor key={tenant.id} tenantId={tenant.id} companyName={tenant.name} />;
}

function StaffRoutingEditor({ tenantId, companyName }: { tenantId: string; companyName: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const load = useServerFn(getStaffRoutingDirectory);
  const saveStaff = useServerFn(saveStaffRoutingNumber);
  const remove = useServerFn(deleteStaffRoutingNumber);
  const toggle = useServerFn(toggleStaffRoutingStatus);
  const saveConfig = useServerFn(saveStaffAlertConfig);
  const sendTest = useServerFn(sendTestStaffAlert);
  const queryKey = ["staff_routing_directory", tenantId];
  const query = useQuery({ queryKey, queryFn: () => load({ data: { tenantId } }), retry: false });
  const [loaded, setLoaded] = useState(false);
  const [template, setTemplate] = useState(DEFAULT_STAFF_ALERT_TEMPLATE);
  const [enabled, setEnabled] = useState(false);
  const [routing, setRouting] = useState(false);
  const [quietThanks, setQuietThanks] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [department, setDepartment] = useState<StaffDepartment>("sales");
  const [roleTitle, setRoleTitle] = useState("");
  const [optedIn, setOptedIn] = useState(false);
  const sendLock = useRef(false);
  const sendReferences = useRef(new Map<string, string>());
  useEffect(() => {
    if (!loaded && query.data?.tenantId === tenantId) {
      const config = query.data.config;
      setTemplate(config.staffAlertTemplate);
      setEnabled(config.staffAlertWhatsappEnabled);
      setRouting(config.autoDepartmentHandoffEnabled);
      setQuietThanks(config.multiCrmCoexistenceEnabled);
      setLoaded(true);
    }
  }, [loaded, query.data, tenantId]);
  const mutation = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: () => {
      toast.success(t("staffRouting.saved"));
      void qc.invalidateQueries({ queryKey });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const test = useMutation({
    mutationFn: async (staffId: string) => {
      const ref = sendReferences.current.get(staffId) ?? crypto.randomUUID();
      sendReferences.current.set(staffId, ref);
      return {
        staffId,
        result: await sendTest({
          data: { tenantId, staffId, clientRef: ref, customTemplate: template },
        }),
      };
    },
    onSuccess: ({ staffId, result }) => {
      if (result.ok) {
        sendReferences.current.delete(staffId);
        toast.success(t("staffRouting.accepted"));
      } else toast.error(result.error || t("staffRouting.notSent"));
    },
    onError: (error: Error) => toast.error(error.message),
    onSettled: () => {
      sendLock.current = false;
    },
  });
  const departmentLabel = (value: string) => {
    const labels = {
      sales: t("staffRouting.sales"),
      reception: t("staffRouting.reception"),
      maintenance: t("staffRouting.maintenance"),
      it_support: t("staffRouting.it"),
      technician: t("staffRouting.technician"),
      department_head: t("staffRouting.head"),
      other: t("staffRouting.other"),
    };
    return labels[value as StaffDepartment] ?? t("staffRouting.other");
  };
  if (query.isPending) return <Skeleton className="h-32 w-full" />;
  if (query.isError || !query.data || query.data.tenantId !== tenantId)
    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
          <p role="alert">{t("staffRouting.loadError")}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            <RefreshCw className="me-2 size-4" />
            {t("staffRouting.retry")}
          </Button>
        </CardContent>
      </Card>
    );
  const busy = !loaded || mutation.isPending || test.isPending;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-4" />
            {t("staffRouting.title")}
          </CardTitle>
          <CardDescription>{t("staffRouting.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="rounded-md border bg-muted/30 p-3 text-sm">{t("staffRouting.limits")}</p>
          <Button variant="outline" disabled={busy} onClick={() => setAdding(!adding)}>
            <Plus className="me-2 size-4" />
            {adding ? t("staffRouting.cancel") : t("staffRouting.add")}
          </Button>
          {adding && (
            <form
              className="grid gap-4 rounded-md border p-4 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                mutation.mutate(async () => {
                  await saveStaff({
                    data: {
                      tenantId,
                      name,
                      phone,
                      department,
                      roleTitle,
                      notifyOnLead: optedIn,
                      isActive: true,
                    },
                  });
                  setName("");
                  setPhone("");
                  setRoleTitle("");
                  setOptedIn(false);
                  setAdding(false);
                });
              }}
            >
              <div>
                <Label htmlFor="routing-name">{t("staffRouting.name")}</Label>
                <Input
                  id="routing-name"
                  required
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="routing-phone">{t("staffRouting.phone")}</Label>
                <Input
                  id="routing-phone"
                  type="tel"
                  dir="ltr"
                  required
                  maxLength={30}
                  placeholder="+971501234567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="routing-dept">{t("staffRouting.department")}</Label>
                <select
                  id="routing-dept"
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value as StaffDepartment)}
                >
                  {STAFF_DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>
                      {departmentLabel(d)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="routing-role">{t("staffRouting.role")}</Label>
                <Input
                  id="routing-role"
                  maxLength={100}
                  value={roleTitle}
                  onChange={(e) => setRoleTitle(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-3 sm:col-span-2">
                <Switch id="routing-consent" checked={optedIn} onCheckedChange={setOptedIn} />
                <Label htmlFor="routing-consent">{t("staffRouting.consent")}</Label>
              </div>
              <Button disabled={busy || !name.trim() || !phone.trim()} type="submit">
                {t("staffRouting.save")}
              </Button>
            </form>
          )}
          {query.data.staffMembers.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("staffRouting.empty")}</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {query.data.staffMembers.map((staff) => (
                <li
                  key={staff.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {staff.name}{" "}
                      <span className="text-xs text-muted-foreground">
                        {departmentLabel(staff.department)}
                      </span>
                    </p>
                    <p className="text-sm">
                      <bdi dir="ltr">{staff.phone}</bdi>
                      {staff.roleTitle && (
                        <span className="ms-2 text-muted-foreground">{staff.roleTitle}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`duty-${staff.id}`}>{t("staffRouting.onDuty")}</Label>
                      <Switch
                        id={`duty-${staff.id}`}
                        checked={staff.isActive}
                        disabled={busy}
                        onCheckedChange={(value) =>
                          mutation.mutate(() =>
                            toggle({ data: { tenantId, id: staff.id, field: "isActive", value } }),
                          )
                        }
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`alerts-${staff.id}`}>{t("staffRouting.alerts")}</Label>
                      <Switch
                        id={`alerts-${staff.id}`}
                        checked={staff.notifyOnLead}
                        disabled={busy}
                        onCheckedChange={(value) =>
                          mutation.mutate(() =>
                            toggle({
                              data: { tenantId, id: staff.id, field: "notifyOnLead", value },
                            }),
                          )
                        }
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || !staff.notifyOnLead || !staff.isActive}
                      aria-label={`${t("staffRouting.test")} — ${staff.name}`}
                      onClick={() => {
                        if (sendLock.current) return;
                        sendLock.current = true;
                        test.mutate(staff.id);
                      }}
                    >
                      <Send className="me-2 size-3" />
                      {t("staffRouting.test")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={busy}
                      aria-label={`${t("staffRouting.remove")} — ${staff.name}`}
                      onClick={() =>
                        mutation.mutate(() => remove({ data: { tenantId, id: staff.id } }))
                      }
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("staffRouting.settings")}</CardTitle>
          <CardDescription>{t("staffRouting.grouping")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Label htmlFor="routing-template">{t("staffRouting.template")}</Label>
          <Textarea
            id="routing-template"
            rows={6}
            maxLength={1000}
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {[
              "customer_name",
              "customer_phone",
              "department",
              "customer_requirements",
              "company_name",
              "timestamp",
            ].map((tag) => (
              <Button
                key={tag}
                size="sm"
                variant="outline"
                onClick={() => setTemplate((old) => `${old} {{${tag}}}`)}
              >{`{{${tag}}}`}</Button>
            ))}
          </div>
          <Label>{t("staffRouting.preview")}</Label>
          <div className="whitespace-pre-wrap rounded-md border bg-muted/20 p-3 text-sm" dir="auto">
            {substituteStaffAlertTags(template, {
              customerName: t("staffRouting.sample"),
              customerPhone: "+971500000000",
              department: departmentLabel(department),
              companyName,
              customerRequirements: t("staffRouting.sampleRequest"),
              timestamp: "—",
            })}
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="routing-enabled">{t("staffRouting.enable")}</Label>
            <Switch
              id="routing-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={busy}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="routing-recommend">{t("staffRouting.recommend")}</Label>
            <Switch
              id="routing-recommend"
              checked={routing}
              onCheckedChange={setRouting}
              disabled={busy}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="routing-quiet">{t("staffRouting.quiet")}</Label>
            <Switch
              id="routing-quiet"
              checked={quietThanks}
              onCheckedChange={setQuietThanks}
              disabled={busy}
            />
          </div>
          <Button
            disabled={busy || template.trim().length < 10}
            onClick={() =>
              mutation.mutate(() =>
                saveConfig({
                  data: {
                    tenantId,
                    staffAlertTemplate: template,
                    staffAlertWhatsappEnabled: enabled,
                    autoDepartmentHandoffEnabled: routing,
                    multiCrmCoexistenceEnabled: quietThanks,
                  },
                }),
              )
            }
          >
            {t("staffRouting.save")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
