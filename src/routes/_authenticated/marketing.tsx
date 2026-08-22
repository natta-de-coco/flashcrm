import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Copy, Download, Plus, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

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
  created_at: string;
};

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
  const [selectedSite, setSelectedSite] = useState<string | null>(null);

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
    onError: (e: Error) => toast.error(e.message),
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
    onError: (e: Error) => toast.error(e.message),
  });

  async function queueCampaign(id: string) {
    const { error } = await supabase
      .from("campaigns")
      .update({ status: "scheduled", scheduled_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Campaign queued. It sends once your email sending domain is verified.");
      void qc.invalidateQueries({ queryKey: ["campaigns"] });
    }
  }

  function copy(value: string) {
    void navigator.clipboard.writeText(value);
    toast.success("Copied to clipboard");
  }

  const activeSite = (sites.data ?? []).find((s) => s.id === selectedSite) ?? sites.data?.[0] ?? null;
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
    onError: (e: Error) => toast.error(e.message),
  });

  const revokeSite = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("lead_sites").update({ status: "revoked" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Site revoked");
      void qc.invalidateQueries({ queryKey: ["lead_sites"] });
    },
    onError: (e: Error) => toast.error(e.message),
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
              Add a site to get its own capture key, then paste the snippet into WordPress (Appearance
              → Theme File Editor, or a Custom HTML block) or Shopify (Online Store → Themes → Edit
              code → theme.liquid).
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
            <CardTitle className="text-base">Marketing campaigns</CardTitle>
            <CardDescription>
              Write a campaign for your subscribed leads. Sending activates once your email domain is
              verified.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="c_name">Campaign name</Label>
                <Input
                  id="c_name"
                  value={campaignForm.name}
                  onChange={(e) => setCampaignForm({ ...campaignForm, name: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="c_subject">Email subject</Label>
                <Input
                  id="c_subject"
                  value={campaignForm.subject}
                  onChange={(e) => setCampaignForm({ ...campaignForm, subject: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="c_body">Message</Label>
              <Textarea
                id="c_body"
                rows={5}
                value={campaignForm.body}
                onChange={(e) => setCampaignForm({ ...campaignForm, body: e.target.value })}
              />
            </div>
            <div>
              <Button
                disabled={!campaignForm.name.trim() || createCampaign.isPending}
                onClick={() => createCampaign.mutate()}
              >
                <Plus className="size-4" /> Save campaign
              </Button>
            </div>

            <div className="space-y-2">
              {(campaigns.data ?? []).map((campaign) => (
                <div
                  key={campaign.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{campaign.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {campaign.subject || "No subject"} · {campaign.recipients_count} recipients
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="capitalize">
                      {campaign.status}
                    </Badge>
                    {campaign.status === "draft" && (
                      <Button size="sm" variant="outline" onClick={() => void queueCampaign(campaign.id)}>
                        <Send className="size-4" /> Queue
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
