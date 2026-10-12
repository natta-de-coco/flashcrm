/**
 * src/components/settings/LeadAlertsSettingsCard.tsx
 *
 * Settings card for configuring instant sales lead notifications
 * via internal email and WhatsApp alerts.
 */

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { friendlyError } from "@/lib/friendly-error";
import {
  getLeadAlertSettings,
  saveLeadAlertSettings,
  type LeadAlertSettingsData,
} from "@/lib/lead-alerts.functions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BellRing, Check, Mail, MessageSquare, Phone, Plus, Trash2, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export function LeadAlertsSettingsCard() {
  const qc = useQueryClient();
  const getSettingsFn = useServerFn(getLeadAlertSettings);
  const saveSettingsFn = useServerFn(saveLeadAlertSettings);

  const { data, isLoading } = useQuery<LeadAlertSettingsData>({
    queryKey: ["lead_alert_settings"],
    queryFn: async () => await getSettingsFn(),
  });

  const [enabled, setEnabled] = useState(true);
  const [emails, setEmails] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [waEnabled, setWaEnabled] = useState(false);
  const [waPhone, setWaPhone] = useState("");

  useEffect(() => {
    if (data) {
      setEnabled(data.leadAlertsEnabled);
      setEmails(data.alertEmailAddresses);
      setWaEnabled(data.alertWhatsappEnabled);
      setWaPhone(data.alertWhatsappPhone || "");
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      return await saveSettingsFn({
        data: {
          leadAlertsEnabled: enabled,
          alertEmailAddresses: emails,
          alertWhatsappEnabled: waEnabled,
          alertWhatsappPhone: waPhone.trim() || null,
        },
      });
    },
    onSuccess: () => {
      toast.success("Lead alert preferences saved!");
      void qc.invalidateQueries({ queryKey: ["lead_alert_settings"] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  function addEmail() {
    const val = newEmail.trim().toLowerCase();
    if (!val || !val.includes("@")) {
      toast.error("Please enter a valid email address");
      return;
    }
    if (emails.includes(val)) {
      toast.error("Email is already in the alert recipients list");
      return;
    }
    setEmails([...emails, val]);
    setNewEmail("");
  }

  function removeEmail(idx: number) {
    setEmails(emails.filter((_, i) => i !== idx));
  }

  if (isLoading) {
    return (
      <Card className="animate-pulse">
        <CardHeader className="h-20 bg-muted/30" />
      </Card>
    );
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-primary/10 text-primary">
              <BellRing className="h-4 w-4" />
            </span>
            <div>
              <CardTitle className="text-base font-bold">Instant Sales Lead Alerts</CardTitle>
              <CardDescription className="text-xs">
                Immediately notify sales reps when a website visitor requests a quote or submits contact info
              </CardDescription>
            </div>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>
      </CardHeader>

      <CardContent className="space-y-6 pt-2">
        {/* Email Alert Recipients */}
        <div className="space-y-3">
          <Label className="text-xs font-semibold flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5 text-muted-foreground" />
            Alert Email Recipients
          </Label>
          <p className="text-xs text-muted-foreground">
            Sales reps who will receive instant email alerts when a lead arrives.
          </p>

          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="sales@mobidigisol.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addEmail())}
              className="text-xs h-9"
              disabled={!enabled}
            />
            <Button size="sm" variant="outline" onClick={addEmail} disabled={!enabled} className="h-9">
              <Plus className="h-3.5 w-3.5 mr-1" /> Add
            </Button>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            {emails.length === 0 && (
              <span className="text-xs text-muted-foreground italic">
                No custom recipients added — workspace admins receive alerts by default.
              </span>
            )}
            {emails.map((em, idx) => (
              <Badge key={idx} variant="secondary" className="gap-1.5 py-1 px-2.5 text-xs">
                {em}
                <button
                  type="button"
                  onClick={() => removeEmail(idx)}
                  className="hover:text-destructive text-muted-foreground ml-1"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        </div>

        {/* WhatsApp Instant Alert */}
        <div className="space-y-3 border-t pt-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5 text-emerald-600" />
                WhatsApp Lead Alerts
              </Label>
              <p className="text-xs text-muted-foreground">
                Dispatch an instant WhatsApp text to your sales on-duty phone number.
              </p>
            </div>
            <Switch checked={waEnabled} onCheckedChange={setWaEnabled} disabled={!enabled} />
          </div>

          {waEnabled && (
            <div className="space-y-2 pt-2">
              <Label htmlFor="waPhone" className="text-xs font-medium">
                Sales WhatsApp Phone (International E.164 format)
              </Label>
              <Input
                id="waPhone"
                type="tel"
                placeholder="+971501234567"
                value={waPhone}
                onChange={(e) => setWaPhone(e.target.value)}
                className="text-xs h-9 font-mono"
                disabled={!enabled}
              />
              <p className="text-[11px] text-muted-foreground">
                Requires an active connected WhatsApp business number in Connect & setup.
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end pt-2 border-t">
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="bg-emerald-600 hover:bg-emerald-700 h-9"
          >
            {saveMutation.isPending ? "Saving..." : "Save Preferences"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
