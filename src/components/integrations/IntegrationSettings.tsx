import { WordPressSitesCard } from "@/components/WordPressSitesCard";
import { addWhatsAppNumber, setDefaultWhatsAppNumber } from "@/lib/wa-numbers.functions";
import { useServerFn } from "@tanstack/react-start";
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
import { useI18n } from "@/hooks/useI18n";

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
  const i18n = useI18n();
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

  const saveNumber = useServerFn(addWhatsAppNumber);
  const addNumber = useMutation({
    // Saved by the server, which encrypts the token and app secret.
    mutationFn: async () => {
      await saveNumber({
        data: {
          label: numForm.label.trim(),
          displayPhone: numForm.display_phone.trim() || undefined,
          phoneNumberId: numForm.phone_number_id.trim(),
          accessToken: numForm.access_token.trim(),
          appSecret: numForm.app_secret.trim() || undefined,
        },
      });
    },
    onSuccess: () => {
      setNumForm({
        label: "",
        display_phone: "",
        phone_number_id: "",
        access_token: "",
        app_secret: "",
      });
      toast.success(i18n.t("integrationSettings.numberConnected"));
      void qc.invalidateQueries({ queryKey: ["wa_numbers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Making a number the default is a server function, not a field: the previous
  // default has to be cleared in the same breath, inside this workspace, or the
  // unique index refuses the change.
  const setDefault = useServerFn(setDefaultWhatsAppNumber);
  const makeDefault = useMutation({
    mutationFn: async (id: string) => setDefault({ data: { id } }),
    onSuccess: () => {
      toast.success(i18n.t("integrationSettings.defaultNumberUpdated"));
      void qc.invalidateQueries({ queryKey: ["wa_numbers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function updateNumber(
    id: string,
    patch: {
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
      toast.success(i18n.t("integrationSettings.numberRemoved"));
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
      toast.success(i18n.t("integrationSettings.templateAdded"));
      void qc.invalidateQueries({ queryKey: ["wa_templates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function setTemplateStatus(id: string, status: string) {
    // "approved" must only ever reflect what Meta actually approved — it
    // used to be settable from here directly, letting anyone declare their
    // own template pre-approved.
    if (status === "approved") {
      toast.error(i18n.t("integrationSettings.templatesAreMarkedApprovedAutomatically"));
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
      toast.success(i18n.t("integrationSettings.whatsappSettingsSaved"));
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
    toast.success(i18n.t("integrationSettings.copiedToClipboard"));
  }

  return (
    <div className="grid max-w-3xl gap-4">
      <Card id="whatsapp" className="scroll-mt-6">
        <CardHeader>
          <CardTitle className="text-base">
            {i18n.t("integrationSettings.whatsappCloudApi")}
          </CardTitle>
          <CardDescription>{i18n.t("integrationSettings.addThisWebhookInMeta")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>{i18n.t("integrationSettings.webhookUrl")}</Label>
            <div className="flex gap-2">
              <Input
                readOnly
                value={webhookUrl}
                aria-label={i18n.t("integrationSettings.whatsappWebhookUrl")}
              />
              <Button
                variant="outline"
                aria-label={i18n.t("integrationSettings.copyWebhookUrl")}
                title={i18n.t("integrationSettings.copyWebhookUrl")}
                onClick={() => copy(webhookUrl)}
              >
                <Copy className="size-4" />
              </Button>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="business_name">{i18n.t("integrationSettings.businessName")}</Label>
            <Input
              id="business_name"
              value={form.business_name}
              disabled={!isAdmin}
              onChange={(e) => setForm({ ...form, business_name: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="display_phone">
              {i18n.t("integrationSettings.displayPhoneNumber")}
            </Label>
            <Input
              id="display_phone"
              value={form.display_phone}
              disabled={!isAdmin}
              onChange={(e) => setForm({ ...form, display_phone: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="phone_number_id">{i18n.t("integrationSettings.phoneNumberId")}</Label>
            <Input
              id="phone_number_id"
              value={form.phone_number_id}
              disabled={!isAdmin}
              onChange={(e) => setForm({ ...form, phone_number_id: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={() => save.mutate()} disabled={!isAdmin || save.isPending}>
              <Save className="size-4" /> {i18n.t("integrationSettings.save")}
            </Button>
            {config.data?.webhook_verified ? (
              <Badge className="bg-brand text-brand-foreground">
                {i18n.t("integrationSettings.webhookVerified")}
              </Badge>
            ) : (
              <Badge variant="secondary">
                {i18n.t("integrationSettings.webhookNotVerifiedYet")}
              </Badge>
            )}
          </div>
          {!isAdmin && (
            <p className="text-xs text-muted-foreground">
              {i18n.t("integrationSettings.onlyAdminsCanChangeThe")}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {/* The count belongs in the heading: this card sits well below the
                fold, and "can I see all of them?" should be answerable without
                scrolling to the end of the list. */}
            {i18n.tr("integrationSettings.connectedWhatsappNumbers", {
              badge: (
                <Badge variant={(numbers.data ?? []).length > 0 ? "secondary" : "outline"}>
                  {(numbers.data ?? []).length}
                </Badge>
              ),
            })}
          </CardTitle>
          <CardDescription>
            {i18n.t("integrationSettings.connectMoreThanOneWhatsapp")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {isAdmin && (
            <div className="grid gap-3 rounded-lg border p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="n_label">{i18n.t("integrationSettings.label")}</Label>
                  <Input
                    id="n_label"
                    placeholder={i18n.t("integrationSettings.salesLine")}
                    value={numForm.label}
                    onChange={(e) => setNumForm({ ...numForm, label: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="n_phone">
                    {i18n.t("integrationSettings.displayPhoneNumber")}
                  </Label>
                  <Input
                    id="n_phone"
                    placeholder="+971 50 123 4567"
                    value={numForm.display_phone}
                    onChange={(e) => setNumForm({ ...numForm, display_phone: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="n_pid">{i18n.t("integrationSettings.phoneNumberId")}</Label>
                  <Input
                    id="n_pid"
                    placeholder={i18n.t("integrationSettings.fromMetaWhatsappApiSetup")}
                    value={numForm.phone_number_id}
                    onChange={(e) => setNumForm({ ...numForm, phone_number_id: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="n_token">{i18n.t("integrationSettings.accessToken")}</Label>
                  <Input
                    id="n_token"
                    type="password"
                    placeholder={i18n.t("integrationSettings.permanentTokenFromMeta")}
                    value={numForm.access_token}
                    onChange={(e) => setNumForm({ ...numForm, access_token: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="n_secret">
                    {i18n.t("integrationSettings.appSecretRecommended")}
                  </Label>
                  <Input
                    id="n_secret"
                    type="password"
                    placeholder={i18n.t("integrationSettings.metaAppSecretVerifiesWebhook")}
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
                  <Plus className="size-4" /> {i18n.t("integrationSettings.connectNumber")}
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {!isAdmin && (
              <p className="text-sm text-muted-foreground">
                {i18n.t("integrationSettings.onlyAdminsCanViewAnd")}
              </p>
            )}
            {isAdmin && (numbers.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">
                {i18n.t("integrationSettings.noNumbersConnectedYetThe")}
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
                      <Badge className="ms-2 bg-brand text-brand-foreground">
                        {i18n.t("integrationSettings.default")}
                      </Badge>
                    )}
                    {!n.active && (
                      <Badge variant="secondary" className="ms-2">
                        {i18n.t("integrationSettings.disabled")}
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {i18n.tr("integrationSettings.id", {
                      value: n.display_phone ?? i18n.t("integrationSettings.noDisplayNumber"),
                      phonenumberid: n.phone_number_id,
                    })}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        className="accent-brand"
                        checked={n.alerts_enabled}
                        onChange={(e) => updateNumber(n.id, { alerts_enabled: e.target.checked })}
                      />
                      {i18n.t("integrationSettings.healthAlerts")}
                    </label>
                    <label className="flex items-center gap-1.5">
                      {i18n.t("integrationSettings.deliverabilityMin")}
                      <Input
                        type="number"
                        aria-label={i18n.t("integrationSettings.minimumDeliveryRatePercent")}
                        min={0}
                        max={100}
                        className="h-7 w-16 px-2 text-xs"
                        defaultValue={n.deliverability_min ?? ""}
                        placeholder={
                          planDefault
                            ? String(Number(planDefault.deliverability_min))
                            : i18n.t("integrationSettings.plan")
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
                      {i18n.t("integrationSettings.readRateMin")}
                      <Input
                        type="number"
                        aria-label={i18n.t("integrationSettings.minimumReadRatePercent")}
                        min={0}
                        max={100}
                        className="h-7 w-16 px-2 text-xs"
                        defaultValue={n.read_rate_min ?? ""}
                        placeholder={
                          planDefault
                            ? String(Number(planDefault.read_rate_min))
                            : i18n.t("integrationSettings.plan")
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
                        {i18n.tr("integrationSettings.leaveBlankToInheritYour", {
                          number: Number(planDefault.deliverability_min),
                          number2: Number(planDefault.read_rate_min),
                        })}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {!n.is_default && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={makeDefault.isPending}
                      onClick={() => makeDefault.mutate(n.id)}
                    >
                      <Star className="size-3.5" /> {i18n.t("integrationSettings.makeDefault")}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => updateNumber(n.id, { active: !n.active })}
                  >
                    {n.active
                      ? i18n.t("integrationSettings.disable")
                      : i18n.t("integrationSettings.enable")}
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
          <CardTitle className="text-base">
            {i18n.t("integrationSettings.websiteChatWidget")}
          </CardTitle>
          <CardDescription>
            {i18n.t("integrationSettings.pasteThisSnippetBeforeThe")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          <div className="flex gap-2">
            <Input
              readOnly
              value={embedSnippet || "Add a website below to generate your snippet"}
              aria-label={i18n.t("integrationSettings.websiteWidgetEmbedSnippet")}
            />
            <Button
              variant="outline"
              aria-label={i18n.t("integrationSettings.copyWebsiteWidgetEmbedSnippet")}
              title={i18n.t("integrationSettings.copyWebsiteWidgetEmbedSnippet")}
              disabled={!embedSnippet}
              onClick={() => copy(embedSnippet)}
            >
              <Copy className="size-4" />
            </Button>
          </div>
          <a
            href={
              widgetSite
                ? `/widget-demo?siteKey=${encodeURIComponent(widgetSite.site_key)}`
                : "/widget-demo"
            }
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-brand hover:underline"
          >
            {i18n.t("integrationSettings.previewTheWidget")}
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {i18n.t("integrationSettings.whatsappMessageTemplates")}
          </CardTitle>
          <CardDescription>
            {i18n.tr("integrationSettings.keepYourMetaApprovedTemplates", {
              value: " {{1}}, {{2}} ",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {isAdmin && (
            <div className="grid gap-3 rounded-lg border p-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="t_name">{i18n.t("integrationSettings.templateName")}</Label>
                  <Input
                    id="t_name"
                    placeholder="order_update"
                    value={tplForm.name}
                    onChange={(e) => setTplForm({ ...tplForm, name: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="t_lang">{i18n.t("integrationSettings.language")}</Label>
                  <Input
                    id="t_lang"
                    value={tplForm.language}
                    onChange={(e) => setTplForm({ ...tplForm, language: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="t_cat">{i18n.t("integrationSettings.category")}</Label>
                  <select
                    id="t_cat"
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                    value={tplForm.category}
                    onChange={(e) => setTplForm({ ...tplForm, category: e.target.value })}
                  >
                    <option value="MARKETING">{i18n.t("integrationSettings.marketing")}</option>
                    <option value="UTILITY">{i18n.t("integrationSettings.utility")}</option>
                    <option value="AUTHENTICATION">
                      {i18n.t("integrationSettings.authentication")}
                    </option>
                  </select>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="t_body">{i18n.t("integrationSettings.body")}</Label>
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
                  <Plus className="size-4" /> {i18n.t("integrationSettings.addTemplate")}
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {(templates.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">
                {i18n.t("integrationSettings.noTemplatesYet")}
              </p>
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
                        <option value="draft">{i18n.t("integrationSettings.draft")}</option>
                        <option value="pending">{i18n.t("integrationSettings.pending")}</option>
                        <option value="approved">{i18n.t("integrationSettings.approved")}</option>
                        <option value="rejected">{i18n.t("integrationSettings.rejected")}</option>
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
