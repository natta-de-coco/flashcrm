/**
 * src/components/settings/MultiMailboxManagerCard.tsx
 *
 * Professional Multi-User Email Accounts & 1 GB Storage Guard Card.
 * Allows each team member (Manager, Sales Rep, Support) to connect their own authenticated mailbox
 * with instant socket test feedback and live storage quota progress monitoring.
 */

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { friendlyError } from "@/lib/friendly-error";
import {
  getStorageBudgetReport,
  listUserEmailAccounts,
  saveUserEmailAccount,
  testUserEmailAccount,
  type UserEmailAccountPublic,
} from "@/lib/user-email-accounts.functions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  CheckCircle2,
  HardDrive,
  Key,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  User,
  Users,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function MultiMailboxManagerCard() {
  const qc = useQueryClient();
  const listAccountsFn = useServerFn(listUserEmailAccounts);
  const saveAccountFn = useServerFn(saveUserEmailAccount);
  const testAccountFn = useServerFn(testUserEmailAccount);
  const getStorageReportFn = useServerFn(getStorageBudgetReport);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<UserEmailAccountPublic | null>(null);

  const [formData, setFormData] = useState({
    label: "",
    accountType: "personal" as "personal" | "shared" | "marketing",
    fromName: "",
    fromEmail: "",
    replyTo: "",
    smtpHost: "",
    smtpPort: 465,
    smtpSecure: true,
    smtpUser: "",
    smtpPassword: "",
    imapHost: "",
    imapPort: 993,
    imapSecure: true,
    imapUser: "",
    imapPassword: "",
    imapEnabled: false,
    signatureHtml: "",
    isDefault: false,
  });

  const accountsQuery = useQuery({
    queryKey: ["user-email-accounts"],
    queryFn: async () => await listAccountsFn(),
  });

  const storageQuery = useQuery({
    queryKey: ["email-storage-budget"],
    queryFn: async () => await getStorageReportFn(),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      return await saveAccountFn({
        data: {
          id: editingAccount?.id,
          ...formData,
        },
      });
    },
    onSuccess: () => {
      toast.success(editingAccount ? "Mailbox updated!" : "New mailbox added!");
      setDialogOpen(false);
      setEditingAccount(null);
      void qc.invalidateQueries({ queryKey: ["user-email-accounts"] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const testMutation = useMutation({
    mutationFn: async ({ accountId, testType }: { accountId: string; testType: "smtp" | "imap" }) => {
      return await testAccountFn({ data: { accountId, testType } });
    },
    onSuccess: (res, vars) => {
      if (res.ok) {
        toast.success(`${vars.testType.toUpperCase()} test passed! (${res.latencyMs}ms)`);
      } else {
        toast.error(`${vars.testType.toUpperCase()} test failed: ${res.message}`);
      }
      void qc.invalidateQueries({ queryKey: ["user-email-accounts"] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  function openCreateDialog() {
    setEditingAccount(null);
    setFormData({
      label: "My Sales Desk",
      accountType: "personal",
      fromName: "",
      fromEmail: "",
      replyTo: "",
      smtpHost: "",
      smtpPort: 465,
      smtpSecure: true,
      smtpUser: "",
      smtpPassword: "",
      imapHost: "",
      imapPort: 993,
      imapSecure: true,
      imapUser: "",
      imapPassword: "",
      imapEnabled: false,
      signatureHtml: "",
      isDefault: false,
    });
    setDialogOpen(true);
  }

  function openEditDialog(acc: UserEmailAccountPublic) {
    setEditingAccount(acc);
    setFormData({
      label: acc.label,
      accountType: acc.accountType,
      fromName: acc.fromName,
      fromEmail: acc.fromEmail,
      replyTo: acc.replyTo || "",
      smtpHost: acc.smtpHost,
      smtpPort: acc.smtpPort,
      smtpSecure: acc.smtpSecure,
      smtpUser: acc.smtpUser,
      smtpPassword: "",
      imapHost: acc.imapHost || "",
      imapPort: acc.imapPort,
      imapSecure: acc.imapSecure,
      imapUser: acc.imapUser || "",
      imapPassword: "",
      imapEnabled: acc.imapEnabled,
      signatureHtml: acc.signatureHtml,
      isDefault: acc.isDefault,
    });
    setDialogOpen(true);
  }

  const storage = storageQuery.data;
  const accounts = accountsQuery.data || [];

  return (
    <Card className="border shadow-xs">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg font-bold">
              <Mail className="size-5 text-brand" /> Team Mailboxes & 1 GB Storage Guard
            </CardTitle>
            <CardDescription className="text-xs">
              Connect dedicated email logins for each representative (Sales, Support, Marketing) with automatic 1 GB storage pruning.
            </CardDescription>
          </div>
          <Button size="sm" onClick={openCreateDialog} className="gap-1.5">
            <Plus className="size-4" /> Add Mailbox
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* 1 GB STORAGE GAUGE */}
        <div className="rounded-xl border bg-muted/30 p-4 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-foreground">
              <HardDrive className="size-4 text-muted-foreground" />
              <span>Workspace Mail Storage Cap</span>
            </div>
            <span className="font-mono text-muted-foreground">
              {storage?.usedFormatted || "0 MB"} / {storage?.maxCapFormatted || "1 GB"} ({storage?.usagePercent || 0}%)
            </span>
          </div>

          <Progress value={storage?.usagePercent || 0} className="h-2" />

          <p className="text-[11px] text-muted-foreground">
            Strict 1 GB hard-cap enforced. Ephemeral raw bodies older than 60 days are auto-pruned once usage exceeds 85% to ensure zero server bloat.
          </p>
        </div>

        {/* CONNECTED MAILBOXES LIST */}
        <div className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Active Connected Mailboxes ({accounts.length})
          </h4>

          {accountsQuery.isLoading && (
            <p className="text-xs text-muted-foreground">Loading connected accounts...</p>
          )}

          {!accountsQuery.isLoading && accounts.length === 0 && (
            <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
              No personal mailboxes configured yet. Click "Add Mailbox" so each representative can send and reply with their own authenticated email address.
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {accounts.map((acc) => (
              <div
                key={acc.id}
                className="flex flex-col justify-between rounded-lg border bg-card p-4 shadow-2xs space-y-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm">{acc.label}</span>
                    <Badge variant={acc.verified ? "default" : "secondary"} className="text-[10px]">
                      {acc.verified ? "Verified" : "Unverified"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {acc.fromName} &lt;{acc.fromEmail}&gt;
                  </p>
                  <div className="flex items-center gap-2 pt-1 text-[11px] text-muted-foreground">
                    <span className="font-mono">{acc.smtpHost}:{acc.smtpPort}</span>
                    {acc.isDefault && <Badge variant="outline" className="text-[9px]">Default</Badge>}
                  </div>
                </div>

                <div className="flex items-center justify-between border-t pt-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => openEditDialog(acc)}
                  >
                    Edit
                  </Button>

                  <div className="flex gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-[11px]"
                      disabled={testMutation.isPending}
                      onClick={() => testMutation.mutate({ accountId: acc.id, testType: "smtp" })}
                    >
                      {testMutation.isPending ? <Loader2 className="size-3 animate-spin" /> : "Test SMTP"}
                    </Button>
                    {acc.imapEnabled && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-[11px]"
                        disabled={testMutation.isPending}
                        onClick={() => testMutation.mutate({ accountId: acc.id, testType: "imap" })}
                      >
                        Test IMAP
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>

      {/* CREATE / EDIT MAILBOX DIALOG */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingAccount ? "Configure Mailbox" : "Add Representative Mailbox"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Connect authenticated SMTP and IMAP credentials so this user can send and reply directly from the portal.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-2 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Mailbox Label</Label>
                <Input
                  placeholder="e.g. Tariq Sales Desk"
                  value={formData.label}
                  onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-xs">Account Scope</Label>
                <select
                  className="w-full h-9 rounded-md border bg-background px-3 text-xs"
                  value={formData.accountType}
                  onChange={(e) => setFormData({ ...formData, accountType: e.target.value as any })}
                >
                  <option value="personal">Personal (Only Me)</option>
                  <option value="shared">Shared (Team Desk)</option>
                  <option value="marketing">Marketing Broadcasts</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Sender Name</Label>
                <Input
                  placeholder="e.g. Tariq Mansoor"
                  value={formData.fromName}
                  onChange={(e) => setFormData({ ...formData, fromName: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-xs">From Email Address</Label>
                <Input
                  type="email"
                  placeholder="tariq@yourdomain.com"
                  value={formData.fromEmail}
                  onChange={(e) => setFormData({ ...formData, fromEmail: e.target.value })}
                />
              </div>
            </div>

            {/* SMTP BLOCK */}
            <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
              <span className="font-semibold text-xs flex items-center gap-1.5">
                <Send className="size-3.5 text-brand" /> Outbound SMTP Settings
              </span>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <Label className="text-[11px]">SMTP Host</Label>
                  <Input
                    placeholder="mail.yourdomain.com"
                    value={formData.smtpHost}
                    onChange={(e) => setFormData({ ...formData, smtpHost: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-[11px]">Port</Label>
                  <Input
                    type="number"
                    value={formData.smtpPort}
                    onChange={(e) => setFormData({ ...formData, smtpPort: parseInt(e.target.value) || 465 })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[11px]">SMTP Username</Label>
                  <Input
                    placeholder="tariq@yourdomain.com"
                    value={formData.smtpUser}
                    onChange={(e) => setFormData({ ...formData, smtpUser: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-[11px]">SMTP Password</Label>
                  <Input
                    type="password"
                    placeholder={editingAccount ? "••••••••" : "Password"}
                    value={formData.smtpPassword}
                    onChange={(e) => setFormData({ ...formData, smtpPassword: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* IMAP BLOCK */}
            <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs flex items-center gap-1.5">
                  <Mail className="size-3.5 text-sky-500" /> Inbound IMAP Reply Sync
                </span>
                <label className="flex items-center gap-1.5 text-[11px]">
                  <Switch
                    checked={formData.imapEnabled}
                    onCheckedChange={(v) => setFormData({ ...formData, imapEnabled: v })}
                  />
                  <span>Enable</span>
                </label>
              </div>

              {formData.imapEnabled && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div>
                    <Label className="text-[11px]">IMAP Host</Label>
                    <Input
                      placeholder="mail.yourdomain.com"
                      value={formData.imapHost}
                      onChange={(e) => setFormData({ ...formData, imapHost: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-[11px]">IMAP Username</Label>
                    <Input
                      placeholder="tariq@yourdomain.com"
                      value={formData.imapUser}
                      onChange={(e) => setFormData({ ...formData, imapUser: e.target.value })}
                    />
                  </div>
                </div>
              )}
            </div>

            <div>
              <Label className="text-xs">Email Signature (HTML or Text)</Label>
              <Textarea
                rows={2}
                placeholder="Best regards, Tariq Mansoor | Sales Team"
                value={formData.signatureHtml}
                onChange={(e) => setFormData({ ...formData, signatureHtml: e.target.value })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              {saveMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "Save Mailbox"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
