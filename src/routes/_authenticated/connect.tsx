import { PageHeader } from "@/components/PageHeader";
import { ConnectBusiness } from "@/components/integrations/ConnectBusiness";
import { IntegrationSettings } from "@/components/integrations/IntegrationSettings";
import { IntegrationLogs } from "@/components/integrations/IntegrationLogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  CheckCircle2,
  Code2,
  Copy,
  Download,
  Globe,
  MessageCircle,
  Route as RouteIcon,
  Sparkles,
  Store,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/connect")({
  head: () => ({
    meta: [
      { title: "Connect & setup — Flas CRM" },
      {
        name: "description",
        content:
          "Guided setup: connect WhatsApp, install the Flas plugin on WordPress or Shopify, and start capturing leads.",
      },
      { property: "og:title", content: "Connect & setup — Flas CRM" },
      {
        property: "og:description",
        content: "Step-by-step guide to syncing your website and WhatsApp with Flas CRM.",
      },
    ],
  }),
  component: ConnectPage,
});

type Site = {
  id: string;
  name: string;
  platform: string;
  site_key: string;
  status: string;
};

type WaNumber = { id: string; label: string; display_phone: string | null; active: boolean };

const PLATFORMS = [
  { id: "wordpress", label: "WordPress", icon: Globe, hint: "Installable plugin ZIP" },
  { id: "shopify", label: "Shopify", icon: Store, hint: "Theme snippet package" },
  { id: "custom", label: "Custom site", icon: Code2, hint: "One script tag" },
] as const;

function ConnectPage() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [origin, setOrigin] = useState("");
  const [siteForm, setSiteForm] = useState({ name: "", platform: "wordpress" });
  const [selectedSite, setSelectedSite] = useState<string | null>(null);

  useEffect(() => setOrigin(window.location.origin), []);

  const waNumbers = useQuery({
    queryKey: ["connect-wa-numbers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wa_numbers")
        .select("id, label, display_phone, active");
      if (error) throw error;
      return data as WaNumber[];
    },
  });

  const sites = useQuery({
    queryKey: ["lead_sites"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_sites")
        .select("id, name, platform, site_key, status")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Site[];
    },
  });

  const createSite = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("lead_sites")
        .insert({ name: siteForm.name.trim(), platform: siteForm.platform })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (row) => {
      setSiteForm({ name: "", platform: "wordpress" });
      setSelectedSite(row.id);
      toast.success("Site key created — follow the install steps below");
      void qc.invalidateQueries({ queryKey: ["lead_sites"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const numbers = waNumbers.data ?? [];
  const allSites = sites.data ?? [];
  const site = allSites.find((s) => s.id === selectedSite) ?? allSites[0] ?? null;

  const popupSnippet = site
    ? `<script src="${origin}/flas-popup.js" data-site-key="${site.site_key}" async></script>`
    : "";

  const steps = [
    { done: numbers.some((n) => n.active), label: "WhatsApp connected" },
    { done: allSites.length > 0, label: "Website added" },
    { done: allSites.some((s) => s.status === "active"), label: "Site live & capturing" },
    { done: false, label: "AI & social growing" },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  function copy(value: string) {
    void navigator.clipboard.writeText(value);
    toast.success("Copied to clipboard");
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-6">
      <PageHeader
        title="Integrations"
        description="Every connection in one place: platforms, WhatsApp, your website and stores, plus a full activity log."
      />

      {/* How it works */}
      <Card className="mb-6 max-w-4xl">
        <CardContent className="flex flex-wrap items-center gap-3 pt-6 text-sm">
          <Badge variant="secondary" className="gap-1.5 px-3 py-1.5">
            <Globe className="size-3.5" /> Your website popup
          </Badge>
          <ArrowRight className="size-4 text-muted-foreground" />
          <Badge variant="secondary" className="gap-1.5 px-3 py-1.5">
            <Download className="size-3.5" /> Flas captures the lead
          </Badge>
          <ArrowRight className="size-4 text-muted-foreground" />
          <Badge variant="secondary" className="gap-1.5 px-3 py-1.5">
            <MessageCircle className="size-3.5" /> Lands in Inbox & Marketing
          </Badge>
          <ArrowRight className="size-4 text-muted-foreground" />
          <Badge variant="secondary" className="gap-1.5 px-3 py-1.5">
            <Sparkles className="size-3.5" /> Flas AI follows up
          </Badge>
        </CardContent>
      </Card>

      {/* Section jump links -- one entry per section that actually exists on
          the page, in the order the page presents them. */}
      <nav className="mb-6 flex flex-wrap gap-2">
        {[
          { href: "#setup", label: "Guided setup" },
          { href: "#platforms", label: "Platform connections" },
          { href: "#whatsapp", label: "WhatsApp & website" },
          { href: "#logs", label: "Integration logs" },
        ].map((s) => (
          <Button key={s.href} asChild variant="outline" size="sm">
            <a href={s.href}>{s.label}</a>
          </Button>
        ))}
      </nav>

      <h2 id="setup" className="mb-3 text-lg font-semibold">
        Guided setup
      </h2>

      <div className="mb-6 max-w-4xl">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium">Setup progress</span>
          <span className="text-muted-foreground">
            {doneCount} of {steps.length} done
          </span>
        </div>
        <Progress value={(doneCount / steps.length) * 100} className="h-2" />
      </div>

      <div className="grid max-w-4xl gap-4">
        {/* Step 1 — WhatsApp */}
        <StepCard
          number={1}
          done={steps[0]?.done ?? false}
          title="Connect your WhatsApp number"
          description="Every conversation from this number flows into your Inbox, with bot replies, assignments and alerts."
        >
          {numbers.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {numbers.map((n) => (
                <Badge key={n.id} variant={n.active ? "default" : "outline"} className="gap-1">
                  <MessageCircle className="size-3" />
                  {n.label}
                  {n.display_phone ? ` · ${n.display_phone}` : ""}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No WhatsApp numbers connected yet.</p>
          )}
          <div>
            <Button asChild variant="outline" size="sm">
              <a href="#whatsapp">
                {numbers.length > 0 ? "Manage numbers" : "Add your first number"} below
              </a>
            </Button>
          </div>
        </StepCard>

        {/* Step 2 — Website */}
        <StepCard
          number={2}
          done={steps[1]?.done ?? false}
          title="Add your website"
          description="Create a site key, then install the Flas popup chatbot on WordPress, Shopify or any custom site. The popup asks for WhatsApp number and email before chatting — every visitor becomes a lead."
        >
          {isAdmin && (
            <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed p-3">
              <div className="grid gap-1.5">
                <Label htmlFor="site-name">Site name</Label>
                <Input
                  id="site-name"
                  placeholder="e.g. Main store"
                  value={siteForm.name}
                  onChange={(e) => setSiteForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-48"
                />
              </div>
              <div className="flex gap-1.5">
                {PLATFORMS.map((p) => (
                  <Button
                    key={p.id}
                    type="button"
                    size="sm"
                    variant={siteForm.platform === p.id ? "default" : "outline"}
                    className="gap-1.5"
                    onClick={() => setSiteForm((f) => ({ ...f, platform: p.id }))}
                  >
                    <p.icon className="size-3.5" />
                    {p.label}
                  </Button>
                ))}
              </div>
              <Button
                size="sm"
                disabled={!siteForm.name.trim() || createSite.isPending}
                onClick={() => createSite.mutate()}
              >
                Create site key
              </Button>
            </div>
          )}

          {allSites.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {allSites.map((s) => (
                <Button
                  key={s.id}
                  size="sm"
                  variant={site?.id === s.id ? "default" : "outline"}
                  onClick={() => setSelectedSite(s.id)}
                >
                  {s.name}
                </Button>
              ))}
            </div>
          )}

          {site && (
            <div className="grid gap-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">
                  {site.name}{" "}
                  <span className="font-normal text-muted-foreground">· {site.platform}</span>
                </p>
                <Badge variant={site.status === "active" ? "default" : "secondary"}>
                  {site.status === "active" ? "Live — capturing leads" : "Waiting for first ping"}
                </Badge>
              </div>

              {site.platform === "wordpress" && (
                <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
                  <li>
                    <Button asChild size="sm" className="gap-1.5">
                      <a
                        href={`${origin}/api/public/plugin/download?siteKey=${site.site_key}&platform=wordpress`}
                      >
                        <Download className="size-3.5" /> Download the Flas plugin (ZIP)
                      </a>
                    </Button>
                  </li>
                  <li>
                    In wp-admin go to <strong>Plugins → Add New → Upload Plugin</strong>, choose the
                    ZIP and press <strong>Activate</strong>.
                  </li>
                  <li>
                    The plugin activates itself with Flas CRM on first page view — the status above
                    flips to <strong>Live</strong>. No keys to paste.
                  </li>
                </ol>
              )}

              {site.platform === "shopify" && (
                <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
                  <li>
                    <Button asChild size="sm" className="gap-1.5">
                      <a
                        href={`${origin}/api/public/plugin/download?siteKey=${site.site_key}&platform=shopify`}
                      >
                        <Download className="size-3.5" /> Download the Shopify theme package
                      </a>
                    </Button>{" "}
                    and follow the README inside.
                  </li>
                  <li>
                    Or paste this snippet in{" "}
                    <strong>Online Store → Themes → Edit code → theme.liquid</strong>, just before{" "}
                    <code>&lt;/body&gt;</code>:
                  </li>
                </ol>
              )}

              {site.platform !== "wordpress" && (
                <div className="grid gap-1.5">
                  <TextareaMono value={popupSnippet} rows={2} />
                  <div>
                    <Button variant="outline" size="sm" onClick={() => copy(popupSnippet)}>
                      <Copy className="size-3.5" /> Copy popup snippet
                    </Button>
                  </div>
                </div>
              )}

              {site.platform === "custom" && (
                <p className="text-sm text-muted-foreground">
                  Paste the snippet anywhere before <code>&lt;/body&gt;</code> on every page where
                  the popup should appear. It registers itself with Flas CRM automatically.
                </p>
              )}
            </div>
          )}
        </StepCard>

        {/* Step 3 — Routing & consent */}
        <StepCard
          number={3}
          done={steps[2]?.done ?? false}
          title="Route leads & stay compliant"
          description="Decide which WhatsApp number receives which leads (by tag, platform, page URL or email domain) and keep consent tracking on — it protects your sender reputation."
        >
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link to="/marketing">
                <RouteIcon className="size-3.5" /> Routing rules & lead capture
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/contacts">View captured contacts</Link>
            </Button>
          </div>
        </StepCard>

        {/* Step 4 — AI growth */}
        <StepCard
          number={4}
          done={steps[3]?.done ?? false}
          title="Let Flas AI grow the account"
          description="Draft campaigns, reply to social comments & DMs, and turn product photos into SEO articles — all from the same workspace."
        >
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link to="/social">
                <Sparkles className="size-3.5" /> Social Hub
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/seo-blog">SEO Studio</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/marketing">Campaign writer</Link>
            </Button>
          </div>
        </StepCard>
      </div>

      <div className="mb-8">
        <ConnectBusiness />
      </div>

      {/* Moved here from Settings: the WhatsApp connection, its numbers, the
          website widget snippet, message templates, WordPress and API keys are
          all integrations, and belong beside the connector cards. */}
      <div className="mb-8">
        <IntegrationSettings />
      </div>

      <div className="mt-8">
        <IntegrationLogs />
      </div>
    </main>
  );
}

function StepCard({
  number,
  done,
  title,
  description,
  children,
}: {
  number: number;
  done: boolean;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={done ? "border-brand/40" : undefined}>
      <CardHeader className="flex-row items-start gap-3 space-y-0">
        <span
          className={
            done
              ? "mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-brand text-brand-foreground"
              : "mt-0.5 grid size-8 shrink-0 place-items-center rounded-full border text-sm font-semibold text-muted-foreground"
          }
        >
          {done ? <CheckCircle2 className="size-4" /> : number}
        </span>
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription className="mt-1">{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 pl-14">{children}</CardContent>
    </Card>
  );
}

function TextareaMono({ value, rows }: { value: string; rows: number }) {
  return (
    <textarea
      readOnly
      rows={rows}
      value={value}
      className="w-full rounded-md border bg-muted px-3 py-2 font-mono text-xs"
    />
  );
}
