import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Users,
  Plus,
  Trash2,
  Phone,
  MessageSquare,
  Sparkles,
  ShieldCheck,
  Wrench,
  Headphones,
  Briefcase,
  Building,
  UserCheck,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  type StaffDepartment,
  type StaffRoutingNumber,
  type StaffAlertConfig,
  DEFAULT_STAFF_ALERT_TEMPLATE,
  substituteStaffAlertTags,
} from "@/lib/staff-routing.functions";

const DEPARTMENTS: { id: StaffDepartment; label: string; icon: typeof Users; color: string }[] = [
  {
    id: "sales",
    label: "Sales Number Management",
    icon: Briefcase,
    color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200",
  },
  {
    id: "reception",
    label: "Reception / Front Desk",
    icon: Building,
    color: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-200",
  },
  {
    id: "maintenance",
    label: "Maintenance / Operations",
    icon: Wrench,
    color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200",
  },
  {
    id: "it_support",
    label: "IT Support / Helpdesk",
    icon: Headphones,
    color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200",
  },
  {
    id: "technician",
    label: "Field Technician / Service Crew",
    icon: Wrench,
    color: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-200",
  },
  {
    id: "department_head",
    label: "Department Head / Supervisor",
    icon: UserCheck,
    color: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-200",
  },
  {
    id: "other",
    label: "Other Team Member",
    icon: Users,
    color: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-200",
  },
];

const TEMPLATE_VARIABLES = [
  { tag: "{{customer_name}}", label: "Customer Name" },
  { tag: "{{customer_phone}}", label: "Customer Phone" },
  { tag: "{{department}}", label: "Department" },
  { tag: "{{customer_requirements}}", label: "Requirements" },
  { tag: "{{company_name}}", label: "Company Name" },
  { tag: "{{timestamp}}", label: "Date & Time" },
];

export function StaffDepartmentRoutingCard() {
  const { tenant } = useTenant();
  const { t } = useI18n();
  const qc = useQueryClient();

  const loadFn = useServerFn(getStaffRoutingDirectory);
  const saveStaffFn = useServerFn(saveStaffRoutingNumber);
  const deleteStaffFn = useServerFn(deleteStaffRoutingNumber);
  const toggleStatusFn = useServerFn(toggleStaffRoutingStatus);
  const saveConfigFn = useServerFn(saveStaffAlertConfig);

  const query = useQuery({
    queryKey: ["staff_routing_directory", tenant?.id],
    enabled: !!tenant?.id,
    queryFn: () => loadFn(),
  });

  // New staff form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [department, setDepartment] = useState<StaffDepartment>("sales");
  const [roleTitle, setRoleTitle] = useState("");
  const [notifyOnLead, setNotifyOnLead] = useState(true);
  const [isActive, setIsActive] = useState(true);

  // Template & settings form state
  const [template, setTemplate] = useState<string>("");
  const [whatsappEnabled, setWhatsappEnabled] = useState(true);
  const [autoHandoffEnabled, setAutoHandoffEnabled] = useState(true);
  const [debounceSeconds, setDebounceSeconds] = useState(6);
  const [multiCrmEnabled, setMultiCrmEnabled] = useState(true);
  const [configLoaded, setConfigLoaded] = useState(false);

  // Synchronize config when loaded
  useMemo(() => {
    if (query.data?.config && !configLoaded) {
      setTemplate(query.data.config.staffAlertTemplate || DEFAULT_STAFF_ALERT_TEMPLATE);
      setWhatsappEnabled(query.data.config.staffAlertWhatsappEnabled);
      setAutoHandoffEnabled(query.data.config.autoDepartmentHandoffEnabled);
      setDebounceSeconds(query.data.config.debounceWindowSeconds || 6);
      setMultiCrmEnabled(query.data.config.multiCrmCoexistenceEnabled);
      setConfigLoaded(true);
    }
  }, [query.data?.config, configLoaded]);

  // Mutations
  const addStaffMutation = useMutation({
    mutationFn: async () => {
      return await saveStaffFn({
        data: {
          name: name.trim(),
          phone: phone.trim(),
          department,
          roleTitle: roleTitle.trim() || undefined,
          notifyOnLead,
          isActive,
        },
      });
    },
    onSuccess: () => {
      toast.success("Staff routing number added successfully");
      setName("");
      setPhone("");
      setRoleTitle("");
      setShowAddForm(false);
      void qc.invalidateQueries({ queryKey: ["staff_routing_directory", tenant?.id] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteStaffMutation = useMutation({
    mutationFn: async (id: string) => {
      return await deleteStaffFn({ data: { id } });
    },
    onSuccess: () => {
      toast.success("Staff number removed");
      void qc.invalidateQueries({ queryKey: ["staff_routing_directory", tenant?.id] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleStatusMutation = useMutation({
    mutationFn: async ({
      id,
      field,
      value,
    }: {
      id: string;
      field: "isActive" | "notifyOnLead";
      value: boolean;
    }) => {
      return await toggleStatusFn({ data: { id, field, value } });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["staff_routing_directory", tenant?.id] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const saveConfigMutation = useMutation({
    mutationFn: async () => {
      return await saveConfigFn({
        data: {
          staffAlertTemplate: template.trim() || DEFAULT_STAFF_ALERT_TEMPLATE,
          staffAlertWhatsappEnabled: whatsappEnabled,
          autoDepartmentHandoffEnabled: autoHandoffEnabled,
          debounceWindowSeconds: debounceSeconds,
          multiCrmCoexistenceEnabled: multiCrmEnabled,
        },
      });
    },
    onSuccess: () => {
      toast.success("Staff alert template & coexistence settings saved");
      void qc.invalidateQueries({ queryKey: ["staff_routing_directory", tenant?.id] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Live preview formatting
  const previewText = useMemo(() => {
    return substituteStaffAlertTags(template || DEFAULT_STAFF_ALERT_TEMPLATE, {
      customerName: "Mohammad Salem",
      customerPhone: "+971 50 987 6543",
      department: department,
      customerRequirements:
        "AC cooling stopped in main server room, urgent technician inspection required.",
      companyName: "Flas Enterprise",
      timestamp: new Date().toLocaleString(),
    });
  }, [template, department]);

  const insertVariable = (tag: string) => {
    setTemplate((prev) => `${prev} ${tag}`);
  };

  const staffList = query.data?.staffMembers || [];

  return (
    <div className="space-y-6">
      {/* 1. Staff Department Numbers Directory */}
      <Card className="border-border">
        <CardHeader className="flex flex-row items-start justify-between pb-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Users className="size-4 text-brand" />
              Staff Department Routing & Sales Numbers
            </CardTitle>
            <CardDescription>
              Assign WhatsApp numbers for Sales, Reception, Maintenance, IT Support, Technicians,
              and Department Heads. The AI recommends these departments and forwards leads directly
              to active staff.
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant={showAddForm ? "outline" : "default"}
            onClick={() => setShowAddForm(!showAddForm)}
            className="shrink-0 gap-1.5"
          >
            <Plus className="size-3.5" />
            {showAddForm ? "Cancel" : "Add Staff Number"}
          </Button>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* Add Staff Form */}
          {showAddForm && (
            <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
              <h4 className="text-sm font-semibold flex items-center gap-1.5">
                <Plus className="size-4 text-brand" /> Add Department Staff Member
              </h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="staff-name">Staff Name / Contact Person *</Label>
                  <Input
                    id="staff-name"
                    placeholder="e.g. Tariq Mansoor (Field Technician)"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="staff-phone">WhatsApp Number (with country code) *</Label>
                  <Input
                    id="staff-phone"
                    placeholder="e.g. +971501234567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="staff-department">Department / Category *</Label>
                  <Select
                    value={department}
                    onValueChange={(v) => setDepartment(v as StaffDepartment)}
                  >
                    <SelectTrigger id="staff-department">
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent>
                      {DEPARTMENTS.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="staff-role">Role Title / Specialization</Label>
                  <Input
                    id="staff-role"
                    placeholder="e.g. Senior HVAC Engineer / Sales Lead"
                    value={roleTitle}
                    onChange={(e) => setRoleTitle(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-6 pt-1">
                <div className="flex items-center gap-2">
                  <Switch
                    id="notify-on-lead"
                    checked={notifyOnLead}
                    onCheckedChange={setNotifyOnLead}
                  />
                  <Label htmlFor="notify-on-lead" className="text-xs font-medium cursor-pointer">
                    Receive Instant Lead Alerts via WhatsApp
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch id="is-active" checked={isActive} onCheckedChange={setIsActive} />
                  <Label htmlFor="is-active" className="text-xs font-medium cursor-pointer">
                    On Duty / Active
                  </Label>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button
                  size="sm"
                  disabled={!name.trim() || !phone.trim() || addStaffMutation.isPending}
                  onClick={() => addStaffMutation.mutate()}
                >
                  Save Staff Member
                </Button>
              </div>
            </div>
          )}

          {/* Staff Members List */}
          {query.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : staffList.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              <Users className="mx-auto size-8 text-muted-foreground/50 mb-2" />
              <p className="font-medium text-foreground">No staff routing numbers configured yet</p>
              <p className="text-xs mt-1">
                Add numbers for your Sales, Maintenance, Reception, or Technician teams so the AI
                chatbot can recommend them and instantly dispatch customer leads.
              </p>
            </div>
          ) : (
            <div className="divide-y rounded-md border">
              {staffList.map((staff) => {
                const deptMeta =
                  DEPARTMENTS.find((d) => d.id === staff.department) ||
                  DEPARTMENTS[DEPARTMENTS.length - 1]!;
                const DeptIcon = deptMeta.icon;
                return (
                  <div
                    key={staff.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-md bg-muted text-foreground shrink-0">
                        <DeptIcon className="size-4" />
                      </div>
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm">{staff.name}</span>
                          <Badge
                            variant="outline"
                            className={`text-xs px-2 py-0 border ${deptMeta.color}`}
                          >
                            {deptMeta.label}
                          </Badge>
                          {staff.roleTitle && (
                            <span className="text-xs text-muted-foreground">
                              · {staff.roleTitle}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1 font-mono">
                            <Phone className="size-3" /> {staff.phone}
                          </span>
                          {staff.notifyOnLead ? (
                            <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                              Alerts: Enabled
                            </span>
                          ) : (
                            <span className="text-muted-foreground">Alerts: Disabled</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 self-end sm:self-center">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground mr-1">
                          {staff.isActive ? "On Duty" : "Off Duty"}
                        </span>
                        <Switch
                          checked={staff.isActive}
                          disabled={toggleStatusMutation.isPending}
                          onCheckedChange={(val) =>
                            toggleStatusMutation.mutate({
                              id: staff.id,
                              field: "isActive",
                              value: val,
                            })
                          }
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive hover:bg-destructive/10"
                        disabled={deleteStaffMutation.isPending}
                        onClick={() => deleteStaffMutation.mutate(staff.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 2. Staff Lead Alert WhatsApp Template & Debounce Settings */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <MessageSquare className="size-4 text-brand" />
            Staff Lead Alert WhatsApp Template & Automation
          </CardTitle>
          <CardDescription>
            Customize the message sent to your technicians and staff members when a customer
            inquires about their department.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="alert-template">Alert Message Template</Label>
            <Textarea
              id="alert-template"
              rows={6}
              className="font-mono text-xs leading-relaxed"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              placeholder={DEFAULT_STAFF_ALERT_TEMPLATE}
            />
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-xs text-muted-foreground mr-1">Insert Variable:</span>
              {TEMPLATE_VARIABLES.map((v) => (
                <button
                  key={v.tag}
                  type="button"
                  onClick={() => insertVariable(v.tag)}
                  className="rounded border bg-muted/50 px-1.5 py-0.5 text-xs font-mono text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  {v.tag}
                </button>
              ))}
            </div>
          </div>

          {/* Live Preview Box */}
          <div className="rounded-lg border bg-emerald-500/5 border-emerald-500/20 p-4 space-y-2">
            <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
              <Sparkles className="size-3.5" /> Live WhatsApp Staff Alert Preview
            </span>
            <div className="rounded-md bg-background/80 border p-3 font-mono text-xs whitespace-pre-wrap leading-relaxed text-foreground/90 shadow-sm">
              {previewText}
            </div>
          </div>

          {/* Coexistence & Anti-Spam Debouncing Settings */}
          <div className="rounded-lg border p-4 space-y-4 bg-muted/20">
            <h4 className="text-sm font-semibold flex items-center gap-1.5 text-foreground">
              <ShieldCheck className="size-4 text-brand" /> Multi-CRM & Message Debounce Protection
            </h4>

            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="whatsapp-alerts-enabled" className="text-sm font-medium">
                  Dispatch WhatsApp Alerts to On-Duty Staff
                </Label>
                <p className="text-xs text-muted-foreground">
                  Sends the formatted template directly to the assigned staff member's WhatsApp
                  number.
                </p>
              </div>
              <Switch
                id="whatsapp-alerts-enabled"
                checked={whatsappEnabled}
                onCheckedChange={setWhatsappEnabled}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="auto-handoff-enabled" className="text-sm font-medium">
                  Auto-Recommend Departments & Handoff
                </Label>
                <p className="text-xs text-muted-foreground">
                  The AI assistant suggests contacting the specific department (Sales, Maintenance,
                  IT, etc.) when the customer's request matches.
                </p>
              </div>
              <Switch
                id="auto-handoff-enabled"
                checked={autoHandoffEnabled}
                onCheckedChange={setAutoHandoffEnabled}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor="multi-crm-enabled" className="text-sm font-medium">
                  Multi-CRM Coexistence Mode
                </Label>
                <p className="text-xs text-muted-foreground">
                  When enabled, FLAS respects external human agents (WhatsApp Web or another CRM)
                  and avoids intrusive bot replies to simple acknowledgments ("ok", "yes",
                  "thanks").
                </p>
              </div>
              <Switch
                id="multi-crm-enabled"
                checked={multiCrmEnabled}
                onCheckedChange={setMultiCrmEnabled}
              />
            </div>

            <div className="flex items-center justify-between gap-4 pt-1">
              <div className="space-y-0.5">
                <Label
                  htmlFor="debounce-seconds"
                  className="text-sm font-medium flex items-center gap-1.5"
                >
                  <Clock className="size-3.5 text-muted-foreground" />
                  Rapid Message Debounce Window (Seconds)
                </Label>
                <p className="text-xs text-muted-foreground">
                  Consolidates 3-4 consecutive messages into one conversational turn instead of
                  sending multiple individual bot replies.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  id="debounce-seconds"
                  type="number"
                  min={2}
                  max={30}
                  className="w-20 text-center font-mono text-sm"
                  value={debounceSeconds}
                  onChange={(e) =>
                    setDebounceSeconds(Math.max(2, Math.min(30, parseInt(e.target.value) || 6)))
                  }
                />
                <span className="text-xs text-muted-foreground">sec</span>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <Button
              disabled={saveConfigMutation.isPending}
              onClick={() => saveConfigMutation.mutate()}
              className="gap-1.5"
            >
              <CheckCircle2 className="size-4" /> Save Template & Settings
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
