import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { draftCampaignMessage } from "@/lib/flash-ai.functions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Download, Loader2, Mail, Plus, Send, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { friendlyError } from "@/lib/friendly-error";
import { CampaignBoard, type CampaignItem } from "@/components/marketing/CampaignBoard";
import { DripSequenceBuilder } from "@/components/marketing/DripSequenceBuilder";
import { getTenantSmtpConfig } from "@/lib/tenant-smtp.functions";


export const Route = createFileRoute("/_authenticated/marketing")({
  head: () => ({
    meta: [
      { title: "Leads & Marketing — Flas CRM" },
      {
        name: "description",
        content:
          "Collect email leads from WordPress and Shopify, then build marketing campaigns for your list.",
      },
      { property: "og:title", content: "Leads & Marketing — Flas CRM" },
      {
        property: "og:description",
        content: "WordPress and Shopify lead capture plus email marketing campaigns.",
      },
    ],
  }),
  component: MarketingPage,
});

type Lead = {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  source: string;
  source_url: string | null;
  subscribed: boolean;
  consent_given: boolean;
  consent_at: string | null;
  created_at: string;
};

type RoutingRule = {
  id: string;
  name: string;
  match_field: "tag" | "source" | "platform" | "email_domain";
  match_value: string;
  wa_number_id: string;
  priority: number;
  active: boolean;
};

type WaNumber = {
  id: string;
  label: string;
  display_phone: string | null;
};

const MATCH_FIELDS = [
  { id: "tag", label: "Lead tag", hint: "e.g. popup-chat, vip, wholesale" },
  { id: "platform", label: "Platform", hint: "wordpress, shopify or other" },
  { id: "source", label: "Source URL contains", hint: "e.g. /wholesale or dubai" },
  { id: "email_domain", label: "Email domain", hint: "e.g. bigcompany.com" },
] as const;

type Site = {
  id: string;
  name: string;
  platform: string;
  site_key: string;
  active: boolean;
  status: string;
  domain: string | null;
  admin_email: string | null;
  activation_token: string;
  popup_greeting: string;
};

type Campaign = {
  id: string;
  name: string;
  subject: string;
  body: string;
  audience_tag: string | null;
  status: string;
  recipients_count: number;
  created_at: string;
};

function MarketingPage() {
  const { isAdmin, user } = useAuth();
  const qc = useQueryClient();
  const [origin, setOrigin] = useState("");
  const [siteForm, setSiteForm] = useState({ name: "", platform: "wordpress" });
  const [campaignForm, setCampaignForm] = useState({ name: "", subject: "", body: "" });
  const [ruleForm, setRuleForm] = useState({
    name: "",
    match_field: "tag" as RoutingRule["match_field"],
    match_value: "",
    wa_number_id: "",
    priority: "100",
  });
  const [selectedSite, setSelectedSite] = useState<string | null>(null);
  const [aiForm, setAiForm] = useState({
    goal: "",
    audience: "",
    tone: "friendly" as "friendly" | "professional" | "urgent" | "playful",
    channel: "whatsapp" as "whatsapp" | "email",
  });
  const [aiDraft, setAiDraft] = useState("");
  const draftWithFlashAi = useServerFn(draftCampaignMessage);
  const getSmtpConfigFn = useServerFn(getTenantSmtpConfig);
  const smtpConfigQuery = useQuery({
    queryKey: ["tenant-smtp-config-marketing"],
    queryFn: async () => {
      try {
        return await getSmtpConfigFn();
      } catch {
        return null;
      }
    },
  });
  const isSmtpVerified = Boolean(smtpConfigQuery.data?.verified);

  useEffect(() => setOrigin(window.location.origin), []);

  const leads = useQuery({
    queryKey: ["leads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as unknown as Lead[];
    },
  });

  const sites = useQuery({
    queryKey: ["lead_sites"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_sites")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as Site[];
    },
  });

  const campaigns = useQuery({
    queryKey: ["campaigns"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaigns")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as Campaign[];
    },
  });

  const routingRules = useQuery({
    queryKey: ["routing_rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_routing_rules")
        .select("*")
        .order("priority", { ascending: true });
      if (error) throw error;
      return data as unknown as RoutingRule[];
    },
  });

  const waNumbers = useQuery({
    queryKey: ["wa-numbers-basic"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wa_numbers")
        .select("id, label, display_phone")
        .eq("active", true);
      if (error) throw error;
      return data as WaNumber[];
    },
  });

  const createRule = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("lead_routing_rules").insert({
        name: ruleForm.name.trim(),
        match_field: ruleForm.match_field,
        match_value: ruleForm.match_value.trim(),
        wa_number_id: ruleForm.wa_number_id,
        priority: Number(ruleForm.priority) || 100,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setRuleForm({
        name: "",
        match_field: "tag",
        match_value: "",
        wa_number_id: "",
        priority: "100",
      });
      toast.success("Routing rule added");
      void qc.invalidateQueries({ queryKey: ["routing_rules"] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const toggleRule = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("lead_routing_rules").update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["routing_rules"] }),
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const deleteRule = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("lead_routing_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Rule removed");
      void qc.invalidateQueries({ queryKey: ["routing_rules"] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const createSite = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("lead_sites")
        .insert({ name: siteForm.name, platform: siteForm.platform });
      if (error) throw error;
    },
    onSuccess: () => {
      setSiteForm({ name: "", platform: "wordpress" });
      toast.success("Site added — copy its snippet below");
      void qc.invalidateQueries({ queryKey: ["lead_sites"] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const createCampaign = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("campaigns").insert({
        name: campaignForm.name,
        subject: campaignForm.subject,
        body: campaignForm.body,
        recipients_count: (leads.data ?? []).filter((l) => l.subscribed).length,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setCampaignForm({ name: "", subject: "", body: "" });
      toast.success("Campaign saved as a draft");
      void qc.invalidateQueries({ queryKey: ["campaigns"] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const generateDraft = useMutation({
    mutationFn: async () =>
      draftWithFlashAi({
        data: {
          goal: aiForm.goal.trim(),
          audience: aiForm.audience.trim() || undefined,
          tone: aiForm.tone,
          channel: aiForm.channel,
        },
      }),
    onSuccess: (res) => {
      setAiDraft(res.draft);
      toast.success("Flas AI drafted your message");
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  function useDraftInCampaign() {
    if (!aiDraft.trim()) return;
    const subjectMatch = aiDraft.match(/^Subject:\s*(.+)$/m);
    setCampaignForm({
      name: aiForm.goal.slice(0, 60) || "Flas AI campaign",
      subject: aiForm.channel === "email" ? (subjectMatch?.[1] ?? "") : "",
      body: aiForm.channel === "email" ? aiDraft.replace(/^Subject:.*\n?/m, "").trim() : aiDraft,
    });
    toast.success("Draft copied into the campaign form below");
  }

  async function queueCampaign(id: string) {
    const { error } = await supabase
      .from("campaigns")
      .update({ status: "scheduled", scheduled_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast.error(friendlyError(error));
    else {
      toast.success("Campaign queued. It sends once your email sending domain is verified.");
      void qc.invalidateQueries({ queryKey: ["campaigns"] });
    }
  }

  function copy(value: string) {
    void navigator.clipboard.writeText(value);
    toast.success("Copied to clipboard");
  }

  if (leads.isLoading || sites.isLoading || campaigns.isLoading || routingRules.isLoading || waNumbers.isLoading) return (
  <div className="space-y-3 p-6">
    {Array.from({ length: 5 }).map((_, i) => (
      <div key={i} className="flex items-center gap-3 rounded-lg border p-4">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>
    ))}
  </div>
);

  const activeSite =
    (sites.data ?? []).find((s) => s.id === selectedSite) ?? sites.data?.[0] ?? null;
  const activateSite = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("lead_sites")
        .update({ status: "active", activated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Site activated");
      void qc.invalidateQueries({ queryKey: ["lead_sites"] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const revokeSite = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("lead_sites")
        .update({ status: "revoked" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Site revoked");
      void qc.invalidateQueries({ queryKey: ["lead_sites"] });
    },
    onError: (e: Error) => toast.error(friendlyError(e)),
  });

  const popupSnippet = activeSite
    ? `<script src="${origin}/flas-popup.js" data-site-key="${activeSite.site_key}" async></script>`
    : "";

  const snippet = activeSite
    ? `<script src="${origin}/lead-capture.js" data-site-key="${activeSite.site_key}" async></script>\n<div data-flas-leads data-heading="Join our newsletter" data-cta="Subscribe"></div>`
    : "";

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Leads &amp; marketing</h1>
        <p className="text-sm text-muted-foreground">
          Capture emails from your WordPress or Shopify store and market to them from one place.
        </p>
      </header>

      <div className="grid max-w-4xl gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Website plugin</CardTitle>
            <CardDescription>
              Add a site to get its own capture key, then paste the snippet into WordPress
              (Appearance → Theme File Editor, or a Custom HTML block) or Shopify (Online Store →
              Themes → Edit code → theme.liquid).
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {isAdmin && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="site_name">Site name</Label>
                  <Input
                    id="site_name"
                    placeholder="My WordPress blog"
                    value={siteForm.name}
                    onChange={(e) => setSiteForm({ ...siteForm, name: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="platform">Platform</Label>
                  <select
                    id="platform"
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                    value={siteForm.platform}
                    onChange={(e) => setSiteForm({ ...siteForm, platform: e.target.value })}
                  >
                    <option value="wordpress">WordPress</option>
                    <option value="shopify">Shopify</option>
                    <option value="other">Other website</option>
                  </select>
                </div>
                <Button
                  disabled={!siteForm.name.trim() || createSite.isPending}
                  onClick={() => createSite.mutate()}
                >
                  <Plus className="size-4" /> Add site
                </Button>
              </div>
            )}

            {(sites.data ?? []).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {(sites.data ?? []).map((site) => (
                  <Button
                    key={site.id}
                    size="sm"
                    variant={activeSite?.id === site.id ? "default" : "outline"}
                    onClick={() => setSelectedSite(site.id)}
                  >
                    {site.name}
                    <Badge variant="secondary" className="ml-1 capitalize">
                      {site.platform}
                    </Badge>
                  </Button>
                ))}
              </div>
            )}

            {activeSite ? (
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-3">
                  <Badge
                    variant={activeSite.status === "active" ? "default" : "secondary"}
                    className="capitalize"
                  >
                    {activeSite.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {activeSite.domain ?? "No domain reported yet"}
                    {activeSite.admin_email ? ` · ${activeSite.admin_email}` : ""}
                  </span>
                  <div className="ml-auto flex flex-wrap gap-2">
                    {activeSite.platform !== "other" && (
                      <Button variant="outline" size="sm" asChild>
                        <a
                          href={`${origin}/api/public/plugin/download?siteKey=${activeSite.site_key}&platform=${activeSite.platform === "shopify" ? "shopify" : "wordpress"}`}
                        >
                          <Download className="size-4" />
                          {activeSite.platform === "shopify"
                            ? "Shopify theme package"
                            : "WordPress plugin"}
                        </a>
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        copy(
                          `${origin}/api/public/plugin/activate?token=${activeSite.activation_token}`,
                        )
                      }
                    >
                      <Copy className="size-4" /> Activation link
                    </Button>
                    {isAdmin && activeSite.status !== "active" && (
                      <Button size="sm" onClick={() => activateSite.mutate(activeSite.id)}>
                        Activate now
                      </Button>
                    )}
                    {isAdmin && activeSite.status === "active" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => revokeSite.mutate(activeSite.id)}
                      >
                        Revoke
                      </Button>
                    )}
                  </div>
                </div>
                <Label>Popup chatbot snippet for {activeSite.name}</Label>
                <Textarea readOnly rows={2} value={popupSnippet} className="font-mono text-xs" />
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => copy(popupSnippet)}>
                    <Copy className="size-4" /> Copy popup snippet
                  </Button>
                </div>
                <Label className="mt-2">Inline form snippet</Label>
                <Textarea readOnly rows={3} value={snippet} className="font-mono text-xs" />
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => copy(snippet)}>
                    <Copy className="size-4" /> Copy snippet
                  </Button>
                </div>
                <div className="rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                  {activeSite.platform === "shopify" ? (
                    <>
                      <strong className="text-foreground">Shopify install:</strong> download the
                      theme package, then in Shopify admin go to Online Store → Themes → Edit code,
                      add the snippet under <em>Snippets</em> and render it before{" "}
                      <code>&lt;/body&gt;</code> in <code>theme.liquid</code>. Full steps are in
                      INSTALL.txt inside the ZIP.
                    </>
                  ) : activeSite.platform === "wordpress" ? (
                    <>
                      <strong className="text-foreground">WordPress install:</strong> Plugins → Add
                      New → Upload Plugin, choose the ZIP, activate — or paste the snippet into a
                      Custom HTML block.
                    </>
                  ) : (
                    <>
                      <strong className="text-foreground">Any website:</strong> paste the popup
                      snippet just before <code>&lt;/body&gt;</code>.
                    </>
                  )}{" "}
                  The site registers itself with Flas CRM on first visit — then activate it with the
                  link above so the popup goes live.
                </div>
                <p className="text-xs text-muted-foreground">
                  Already have a signup form? Add <code>class="flas-lead-form"</code> to it and the
                  plugin captures submissions automatically.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No capture sites yet. {isAdmin ? "Add one above." : "Ask an admin to add one."}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4 text-primary" /> Flas AI campaign writer
            </CardTitle>
            <CardDescription>
              Tell Flas AI your goal — it studies your business profile and lead data, then drafts a
              compliant, ready-to-send message. Review it, then drop it into a campaign below.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ai_goal">Campaign goal</Label>
              <Textarea
                id="ai_goal"
                rows={2}
                placeholder="e.g. Re-engage wholesale leads who went quiet last month with a 10% reorder offer"
                value={aiForm.goal}
                onChange={(e) => setAiForm({ ...aiForm, goal: e.target.value })}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5 sm:col-span-1">
                <Label htmlFor="ai_audience">Audience (optional)</Label>
                <Input
                  id="ai_audience"
                  placeholder="e.g. popup-chat leads"
                  value={aiForm.audience}
                  onChange={(e) => setAiForm({ ...aiForm, audience: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ai_tone">Tone</Label>
                <select
                  id="ai_tone"
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                  value={aiForm.tone}
                  onChange={(e) =>
                    setAiForm({ ...aiForm, tone: e.target.value as typeof aiForm.tone })
                  }
                >
                  <option value="friendly">Friendly</option>
                  <option value="professional">Professional</option>
                  <option value="urgent">Urgent</option>
                  <option value="playful">Playful</option>
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ai_channel">Channel</Label>
                <select
                  id="ai_channel"
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                  value={aiForm.channel}
                  onChange={(e) =>
                    setAiForm({ ...aiForm, channel: e.target.value as typeof aiForm.channel })
                  }
                >
                  <option value="whatsapp">WhatsApp</option>
                  <option value="email">Email</option>
                </select>
              </div>
            </div>
            <div>
              <Button
                disabled={aiForm.goal.trim().length < 3 || generateDraft.isPending}
                onClick={() => generateDraft.mutate()}
              >
                {generateDraft.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                Draft with Flas AI
              </Button>
            </div>
            {aiDraft && (
              <div className="grid gap-2">
                <Label htmlFor="ai_draft">Draft — edit anything before using it</Label>
                <Textarea
                  id="ai_draft"
                  rows={7}
                  value={aiDraft}
                  onChange={(e) => setAiDraft(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={useDraftInCampaign}>
                    <Send className="size-4" /> Use in campaign form
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => generateDraft.mutate()}
                    disabled={generateDraft.isPending}
                  >
                    Regenerate
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Campaigns only send to leads who gave consent — Flas AI already includes the
                  required opt-out line.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Leads <Badge variant="secondary">{(leads.data ?? []).length}</Badge>
            </CardTitle>
            <CardDescription>Every email captured from your sites and chat widget.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(leads.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No leads collected yet.</p>
            )}
            {(leads.data ?? []).map((lead) => (
              <div
                key={lead.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{lead.name || lead.email}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {lead.email}
                    {lead.phone ? ` · ${lead.phone}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="capitalize">
                    {lead.source}
                  </Badge>
                  {lead.consent_given ? (
                    <Badge variant="outline" className="text-[10px]">
                      Consented
                      {lead.consent_at
                        ? ` · ${new Date(lead.consent_at).toLocaleDateString()}`
                        : ""}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">
                      No consent
                    </Badge>
                  )}
                  <span className="text-[11px] text-muted-foreground">
                    {new Date(lead.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lead routing rules</CardTitle>
            <CardDescription>
              Automatically assign each new website lead to the right WhatsApp number. Rules are
              checked in priority order — the first match wins.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {(waNumbers.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Connect a WhatsApp number in Settings first, then create routing rules here.
              </p>
            ) : (
              isAdmin && (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="rule_name">Rule name</Label>
                    <Input
                      id="rule_name"
                      placeholder="Shopify leads → sales line"
                      value={ruleForm.name}
                      onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="match_field">Match by</Label>
                    <select
                      id="match_field"
                      className="h-9 rounded-md border bg-background px-3 text-sm"
                      value={ruleForm.match_field}
                      onChange={(e) =>
                        setRuleForm({
                          ...ruleForm,
                          match_field: e.target.value as RoutingRule["match_field"],
                        })
                      }
                    >
                      {MATCH_FIELDS.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="match_value">Value</Label>
                    <Input
                      id="match_value"
                      placeholder={
                        MATCH_FIELDS.find((f) => f.id === ruleForm.match_field)?.hint ?? ""
                      }
                      value={ruleForm.match_value}
                      onChange={(e) => setRuleForm({ ...ruleForm, match_value: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="rule_number">Assign to</Label>
                    <select
                      id="rule_number"
                      className="h-9 rounded-md border bg-background px-3 text-sm"
                      value={ruleForm.wa_number_id}
                      onChange={(e) => setRuleForm({ ...ruleForm, wa_number_id: e.target.value })}
                    >
                      <option value="">Choose a number…</option>
                      {(waNumbers.data ?? []).map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.label}
                          {n.display_phone ? ` · ${n.display_phone}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid w-24 gap-1.5">
                    <Label htmlFor="rule_priority">Priority</Label>
                    <Input
                      id="rule_priority"
                      type="number"
                      value={ruleForm.priority}
                      onChange={(e) => setRuleForm({ ...ruleForm, priority: e.target.value })}
                    />
                  </div>
                  <Button
                    disabled={
                      !ruleForm.name.trim() ||
                      !ruleForm.match_value.trim() ||
                      !ruleForm.wa_number_id ||
                      createRule.isPending
                    }
                    onClick={() => createRule.mutate()}
                  >
                    <Plus className="size-4" /> Add rule
                  </Button>
                </div>
              )
            )}

            <div className="space-y-2">
              {(routingRules.data ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No rules yet — leads go to your default WhatsApp number.
                </p>
              )}
              {(routingRules.data ?? []).map((rule) => {
                const number = (waNumbers.data ?? []).find((n) => n.id === rule.wa_number_id);
                return (
                  <div
                    key={rule.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{rule.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {MATCH_FIELDS.find((f) => f.id === rule.match_field)?.label}:{" "}
                        <code className="rounded bg-muted px-1">{rule.match_value}</code> →{" "}
                        {number?.label ?? "Unknown number"} · priority {rule.priority}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={rule.active}
                        onCheckedChange={(v) => toggleRule.mutate({ id: rule.id, active: v })}
                      />
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteRule.mutate(rule.id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <DripSequenceBuilder />

        <CampaignBoard
          campaigns={((campaigns.data ?? []) as unknown) as CampaignItem[]}
          isSmtpVerified={isSmtpVerified}
          audienceCount={(leads.data ?? []).filter((l) => l.subscribed).length}
        />
      </div>
    </main>
  );
}
