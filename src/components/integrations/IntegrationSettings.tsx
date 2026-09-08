import { WordPressSitesCard } from "@/components/WordPressSitesCard";
import { ApiKeysCard } from "@/components/settings/ApiKeysCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Plus, Save, Star, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * Everything that wires Flas to an outside system: the WhatsApp Cloud API
 * connection, the numbers it routes through, the website chat widget snippet,
 * Meta-approved message templates, WordPress publishing and developer API keys.
 *
 * These all used to sit on the Settings page, mixed in with the company's own
 * country, currency, billing and teammates -- so "Settings" meant two unrelated
 * things and you had to know which. Settings is now account and company
 * preferences; anything that connects Flas to a third party lives here, beside
 * the connector cards it belongs with.
 */
export function IntegrationSettings() {
  const { isAdmin } = useAuth();
  const { tenant } = useTenant();
  const qc = useQueryClient();
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const [form, setForm] = useState({ business_name: "", display_phone: "", phone_number_id: "" });
  const [tplForm, setTplForm] = useState({
    name: "",
    language: "en_US",
    category: "UTILITY",
    body: "",
  });
  const [numForm, setNumForm] = useState({
    label: "",
    display_phone: "",
    phone_number_id: "",
    access_token: "",
    app_secret: "",
  });

  const numbers = useQuery({
    queryKey: ["wa_numbers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wa_numbers")
        .select(
          "id, label, display_phone, phone_number_id, is_default, active, created_at, alerts_enabled, deliverability_min, read_rate_min",
        )
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: isAdmin,
  });

  const planThresholds = useQuery({
    queryKey: ["plan_thresholds"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plan_thresholds")
        .select("plan, deliverability_min, read_rate_min");
      if (error) throw error;
      return data ?? [];
    },
    enabled: isAdmin,
  });

  const planDefault =
    planThresholds.data?.find((t) => t.plan === (tenant?.plan ?? "default")) ??
    planThresholds.data?.find((t) => t.plan === "default");

  const addNumber = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("wa_numbers").insert({
        label: numForm.label.trim(),
        display_phone: numForm.display_phone.trim() || null,
        phone_number_id: numForm.phone_number_id.trim(),
        access_token: numForm.access_token.trim(),
        ...(numForm.app_secret.trim() ? { app_secret: numForm.app_secret.trim() } : {}),
        is_default: (numbers.data ?? []).length === 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNumForm({
        label: "",
        display_phone: "",
        phone_number_id: "",
        access_token: "",
        app_secret: "",
      });
      toast.success("Number connected");
      void qc.invalidateQueries({ queryKey: ["wa_numbers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function updateNumber(
    id: string,
    patch: {
      is_default?: boolean;
      active?: boolean;
      label?: string;
      alerts_enabled?: boolean;
      deliverability_min?: number | null;
      read_rate_min?: number | null;
    },
  ) {
    const { error } = await supabase.from("wa_numbers").update(patch).eq("id", id);
    if (error) toast.error(error.message);
    else void qc.invalidateQueries({ queryKey: ["wa_numbers"] });
  }

  async function removeNumber(id: string) {
    const { error } = await supabase.from("wa_numbers").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Number removed");
      void qc.invalidateQueries({ queryKey: ["wa_numbers"] });
    }
  }

  const templates = useQuery({
    queryKey: ["wa_templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wa_templates")
        .select("id, name, language, category, body, status")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const createTpl = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("wa_templates").insert({
        name: tplForm.name.trim(),
        language: tplForm.language.trim() || "en_US",
        category: tplForm.category,
        body: tplForm.body.trim(),
        variables: (tplForm.body.match(/\{\{\d+\}\}/g) ?? []).map((v) => v.replace(/[^0-9]/g, "")),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setTplForm({ name: "", language: "en_US", category: "UTILITY", body: "" });
      toast.success("Template added");
      void qc.invalidateQueries({ queryKey: ["wa_templates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function setTemplateStatus(id: string, status: string) {
    // "approved" must only ever reflect what Meta actually approved — it
    // used to be settable from here directly, letting anyone declare their
    // own template pre-approved.
    if (status === "approved") {
      toast.error("Templates are marked approved automatically once Meta approves them.");
      return;
    }
    const { error } = await supabase.from("wa_templates").update({ status }).eq("id", id);
    if (error) toast.error(error.message);
    else void qc.invalidateQueries({ queryKey: ["wa_templates"] });
  }

  // Per-tenant WhatsApp connection card. Previously this read/wrote a single
  // platform-wide row shared by every tenant on the CRM.
  const config = useQuery({
    queryKey: ["tenant_wa_config", tenant?.id],
    enabled: !!tenant?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_wa_config")
        .select("*")
        .eq("tenant_id", tenant!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    const c = config.data;
    if (!c) return;
    setForm({
      business_name: c.business_name ?? "",
      display_phone: c.display_phone ?? "",
      phone_number_id: c.phone_number_id ?? "",
    });
  }, [config.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!tenant?.id) throw new Error("Your workspace is still being set up.");
      const { error } = await supabase.from("tenant_wa_config").upsert(
        {
          tenant_id: tenant.id,
          business_name: form.business_name || null,
          display_phone: form.display_phone || null,
          phone_number_id: form.phone_number_id || null,
        },
        { onConflict: "tenant_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("WhatsApp settings saved");
      void qc.invalidateQueries({ queryKey: ["tenant_wa_config", tenant?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const webhookUrl = `${origin}/api/public/whatsapp/webhook`;
  // The chat endpoint requires a site key -- an anonymous, tenant-less session
  // was a cross-tenant hijack path. The snippet used to omit it, so every
  // message the widget sent was rejected as an invalid payload.
  const widgetSites = useQuery({
    queryKey: ["widget-sites"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_sites")
        .select("id, name, site_key, status")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const widgetSite = (widgetSites.data ?? [])[0] ?? null;
  const embedSnippet = widgetSite
    ? `<script src="${origin}/widget.js" data-site-key="${widgetSite.site_key}" async></script>`
    : "";

  function copy(value: string) {
    void navigator.clipboard.writeText(value);
    toast.success("Copied to clipboard");
  }

  return (
    <div className="grid max-w-3xl gap-4">
      <Card id="whatsapp" className="scroll-mt-6">
        <CardHeader>
          <CardTitle className="text-base">WhatsApp Cloud API</CardTitle>
          <CardDescription>
            Add this webhook in Meta → WhatsApp → Configuration, using the verify token stored in
            your backend secrets.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>Webhook URL</Label>
            <div className="flex gap-2">
              <Input readOnly value={webhookUrl} aria-label="WhatsApp webhook URL" />
              <Button variant="outline" onClick={() => copy(webhookUrl)}>
                <Copy className="size-4" />
              </Button>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="business_name">Business name</Label>
            <Input
              id="business_name"
              value={form.business_name}
              disabled={!isAdmin}
              onChange={(e) => setForm({ ...form, business_name: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="display_phone">Display phone number</Label>
            <Input
              id="display_phone"
              value={form.display_phone}
              disabled={!isAdmin}
              onChange={(e) => setForm({ ...form, display_phone: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="phone_number_id">Phone number ID</Label>
            <Input
              id="phone_number_id"
              value={form.phone_number_id}
              disabled={!isAdmin}
              onChange={(e) => setForm({ ...form, phone_number_id: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={() => save.mutate()} disabled={!isAdmin || save.isPending}>
              <Save className="size-4" /> Save
            </Button>
            {config.data?.webhook_verified ? (
              <Badge className="bg-brand text-brand-foreground">Webhook verified</Badge>
            ) : (
              <Badge variant="secondary">Webhook not verified yet</Badge>
            )}
          </div>
          {!isAdmin && (
            <p className="text-xs text-muted-foreground">
              Only admins can change the WhatsApp connection.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Connected WhatsApp numbers
            {/* The count belongs in the heading: this card sits well below the
                fold, and "can I see all of them?" should be answerable without
                scrolling to the end of the list. */}
            <Badge variant={(numbers.data ?? []).length > 0 ? "secondary" : "outline"}>
              {(numbers.data ?? []).length}
            </Badge>
          </CardTitle>
          <CardDescription>
            Connect more than one WhatsApp Business number. Incoming chats are routed to the number
            the customer messaged, and replies go out from the same number.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {isAdmin && (
            <div className="grid gap-3 rounded-lg border p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="n_label">Label</Label>
                  <Input
                    id="n_label"
                    placeholder="Sales line"
                    value={numForm.label}
                    onChange={(e) => setNumForm({ ...numForm, label: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="n_phone">Display phone number</Label>
                  <Input
                    id="n_phone"
                    placeholder="+971 50 123 4567"
                    value={numForm.display_phone}
                    onChange={(e) => setNumForm({ ...numForm, display_phone: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="n_pid">Phone number ID</Label>
                  <Input
                    id="n_pid"
                    placeholder="From Meta → WhatsApp → API Setup"
                    value={numForm.phone_number_id}
                    onChange={(e) => setNumForm({ ...numForm, phone_number_id: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="n_token">Access token</Label>
                  <Input
                    id="n_token"
                    type="password"
                    placeholder="Permanent token from Meta"
                    value={numForm.access_token}
                    onChange={(e) => setNumForm({ ...numForm, access_token: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="n_secret">App secret (recommended)</Label>
                  <Input
                    id="n_secret"
                    type="password"
                    placeholder="Meta app secret — verifies webhook signatures"
                    value={numForm.app_secret}
                    onChange={(e) => setNumForm({ ...numForm, app_secret: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <Button
                  disabled={
                    !numForm.label.trim() ||
                    !numForm.phone_number_id.trim() ||
                    !numForm.access_token.trim() ||
                    addNumber.isPending
                  }
                  onClick={() => addNumber.mutate()}
                >
                  <Plus className="size-4" /> Connect number
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {!isAdmin && (
              <p className="text-sm text-muted-foreground">
                Only admins can view and manage connected numbers.
              </p>
            )}
            {isAdmin && (numbers.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">
                No numbers connected yet — the env-var configuration is used as a fallback.
              </p>
            )}
            {(numbers.data ?? []).map((n) => (
              <div
                key={n.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {n.label}
                    {n.is_default && (
                      <Badge className="ml-2 bg-brand text-brand-foreground">default</Badge>
                    )}
                    {!n.active && (
                      <Badge variant="secondary" className="ml-2">
                        disabled
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {n.display_phone ?? "No display number"} · ID {n.phone_number_id}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        className="accent-brand"
                        checked={n.alerts_enabled}
                        onChange={(e) => updateNumber(n.id, { alerts_enabled: e.target.checked })}
                      />
                      Health alerts
                    </label>
                    <label className="flex items-center gap-1.5">
                      Deliverability min
                      <Input
                        type="number"
                        aria-label="Minimum delivery rate percent"
                        min={0}
                        max={100}
                        className="h-7 w-16 px-2 text-xs"
                        defaultValue={n.deliverability_min ?? ""}
                        placeholder={
                          planDefault ? String(Number(planDefault.deliverability_min)) : "plan"
                        }
                        disabled={!n.alerts_enabled}
                        onBlur={(e) => {
                          const raw = e.target.value.trim();
                          const v = raw === "" ? null : Number(raw);
                          if ((v === null || Number.isFinite(v)) && v !== n.deliverability_min)
                            updateNumber(n.id, { deliverability_min: v });
                        }}
                      />
                      %
                    </label>
                    <label className="flex items-center gap-1.5">
                      Read rate min
                      <Input
                        type="number"
                        aria-label="Minimum read rate percent"
                        min={0}
                        max={100}
                        className="h-7 w-16 px-2 text-xs"
                        defaultValue={n.read_rate_min ?? ""}
                        placeholder={
                          planDefault ? String(Number(planDefault.read_rate_min)) : "plan"
                        }
                        disabled={!n.alerts_enabled}
                        onBlur={(e) => {
                          const raw = e.target.value.trim();
                          const v = raw === "" ? null : Number(raw);
                          if ((v === null || Number.isFinite(v)) && v !== n.read_rate_min)
                            updateNumber(n.id, { read_rate_min: v });
                        }}
                      />
                      %
                    </label>
                    {planDefault && (
                      <span className="w-full text-[11px] text-muted-foreground">
                        Leave blank to inherit your plan default (
                        {Number(planDefault.deliverability_min)}% deliverability /{" "}
                        {Number(planDefault.read_rate_min)}% read rate).
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {!n.is_default && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => updateNumber(n.id, { is_default: true })}
                    >
                      <Star className="size-3.5" /> Make default
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => updateNumber(n.id, { active: !n.active })}
                  >
                    {n.active ? "Disable" : "Enable"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => removeNumber(n.id)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card id="widget" className="scroll-mt-6">
        <CardHeader>
          <CardTitle className="text-base">Website chat widget</CardTitle>
          <CardDescription>
            Paste this snippet before the closing &lt;/body&gt; tag of your website. Chats appear in
            your inbox instantly.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          <div className="flex gap-2">
            <Input
              readOnly
              value={embedSnippet || "Add a website below to generate your snippet"}
              aria-label="Website widget embed snippet"
            />
            <Button variant="outline" disabled={!embedSnippet} onClick={() => copy(embedSnippet)}>
              <Copy className="size-4" />
            </Button>
          </div>
          <a
            href={widgetSite ? `/widget-demo?siteKey=${encodeURIComponent(widgetSite.site_key)}` : "/widget-demo"}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-brand hover:underline"
          >
            Preview the widget
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">WhatsApp message templates</CardTitle>
          <CardDescription>
            Keep your Meta-approved templates here so agents and the chatbot can send them. Use
            {" {{1}}, {{2}} "}
            for variables and mark a template approved once Meta approves it.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {isAdmin && (
            <div className="grid gap-3 rounded-lg border p-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="t_name">Template name</Label>
                  <Input
                    id="t_name"
                    placeholder="order_update"
                    value={tplForm.name}
                    onChange={(e) => setTplForm({ ...tplForm, name: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="t_lang">Language</Label>
                  <Input
                    id="t_lang"
                    value={tplForm.language}
                    onChange={(e) => setTplForm({ ...tplForm, language: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="t_cat">Category</Label>
                  <select
                    id="t_cat"
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                    value={tplForm.category}
                    onChange={(e) => setTplForm({ ...tplForm, category: e.target.value })}
                  >
                    <option value="MARKETING">Marketing</option>
                    <option value="UTILITY">Utility</option>
                    <option value="AUTHENTICATION">Authentication</option>
                  </select>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="t_body">Body</Label>
                <Textarea
                  id="t_body"
                  rows={3}
                  placeholder="Hi {{1}}, your order {{2}} is on its way!"
                  value={tplForm.body}
                  onChange={(e) => setTplForm({ ...tplForm, body: e.target.value })}
                />
              </div>
              <div>
                <Button
                  disabled={!tplForm.name.trim() || !tplForm.body.trim() || createTpl.isPending}
                  onClick={() => createTpl.mutate()}
                >
                  <Plus className="size-4" /> Add template
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {(templates.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No templates yet.</p>
            )}
            {(templates.data ?? []).map((tpl) => (
              <div key={tpl.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {tpl.name}{" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        {tpl.language} · {tpl.category.toLowerCase()}
                      </span>
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                      {tpl.body}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={tpl.status === "approved" ? "default" : "secondary"}
                      className={tpl.status === "approved" ? "bg-brand text-brand-foreground" : ""}
                    >
                      {tpl.status}
                    </Badge>
                    {isAdmin && (
                      <select
                        className="h-8 rounded-md border bg-background px-2 text-xs"
                        value={tpl.status}
                        onChange={(e) => void setTemplateStatus(tpl.id, e.target.value)}
                      >
                        <option value="draft">draft</option>
                        <option value="pending">pending</option>
                        <option value="approved">approved</option>
                        <option value="rejected">rejected</option>
                      </select>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {isAdmin && <ApiKeysCard origin={origin} />}

      <WordPressSitesCard />
    </div>
  );
}
