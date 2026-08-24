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
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { supabase } from "@/integrations/supabase/client";
import { testWpConnectionFn } from "@/lib/seo.functions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Globe, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type WpSite = {
  id: string;
  label: string;
  site_url: string;
  username: string;
  default_author: string | null;
  seo_plugin: string;
};

/** Settings card: manage WordPress connections used by the SEO Studio. */
export function WordPressSitesCard() {
  const { isAdmin, user } = useAuth();
  const { tenant } = useTenant();
  const qc = useQueryClient();
  const testConnection = useServerFn(testWpConnectionFn);

  const [form, setForm] = useState({
    label: "",
    site_url: "",
    username: "",
    app_password: "",
    default_author: "",
    seo_plugin: "yoast",
  });
  const [testResult, setTestResult] = useState<string | null>(null);

  const sites = useQuery({
    queryKey: ["wordpress_sites"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wordpress_sites")
        .select("id, label, site_url, username, default_author, seo_plugin")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as WpSite[];
    },
  });

  const addSite = useMutation({
    mutationFn: async () => {
      if (!tenant?.id) throw new Error("Workspace not loaded yet.");
      const { error } = await supabase.from("wordpress_sites").insert({
        tenant_id: tenant.id,
        label: form.label || form.site_url,
        site_url: form.site_url.replace(/\/+$/, ""),
        username: form.username,
        app_password: form.app_password.replace(/\s+/g, ""),
        default_author: form.default_author || null,
        seo_plugin: form.seo_plugin,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("WordPress site connected");
      setForm({
        label: "",
        site_url: "",
        username: "",
        app_password: "",
        default_author: "",
        seo_plugin: "yoast",
      });
      setTestResult(null);
      qc.invalidateQueries({ queryKey: ["wordpress_sites"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save site"),
  });

  const removeSite = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("wordpress_sites").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wordpress_sites"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not remove site"),
  });

  const testMutation = useMutation({
    mutationFn: () =>
      testConnection({
        data: {
          siteUrl: form.site_url,
          username: form.username,
          appPassword: form.app_password.replace(/\s+/g, ""),
        },
      }),
    onSuccess: (r) => {
      setTestResult(
        `Connected as ${r.user}. Found ${r.categories.length} categories and ${r.tags.length} tags.`,
      );
      toast.success("Connection works");
    },
    onError: (e) => {
      setTestResult(null);
      toast.error(e instanceof Error ? e.message : "Connection failed");
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">WordPress sites</CardTitle>
        <CardDescription>
          Connect WordPress for one-click publishing from the SEO Studio. Create an application
          password in WordPress → Users → Profile → Application Passwords. The password is stored
          encrypted and is never readable back through the app.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {(sites.data ?? []).map((s) => (
          <div
            key={s.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
          >
            <div className="flex min-w-0 items-center gap-2">
              <Globe className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{s.label}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {s.site_url} · {s.username}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-[10px] capitalize">
                {s.seo_plugin === "none" ? "no SEO plugin" : s.seo_plugin}
              </Badge>
              {isAdmin && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => removeSite.mutate(s.id)}
                  aria-label={`Remove ${s.label}`}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          </div>
        ))}

        {isAdmin && (
          <div className="grid gap-2 rounded-lg border border-dashed p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="wp_label">Label</Label>
                <Input
                  id="wp_label"
                  placeholder="Main blog"
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="wp_url">Site URL</Label>
                <Input
                  id="wp_url"
                  placeholder="https://example.com"
                  value={form.site_url}
                  onChange={(e) => setForm({ ...form, site_url: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="wp_user">WordPress username</Label>
                <Input
                  id="wp_user"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="wp_pass">Application password</Label>
                <Input
                  id="wp_pass"
                  type="password"
                  placeholder="xxxx xxxx xxxx xxxx"
                  value={form.app_password}
                  onChange={(e) => setForm({ ...form, app_password: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="wp_author">Default author (optional)</Label>
                <Input
                  id="wp_author"
                  value={form.default_author}
                  onChange={(e) => setForm({ ...form, default_author: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>SEO plugin</Label>
                <Select
                  value={form.seo_plugin}
                  onValueChange={(v) => setForm({ ...form, seo_plugin: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="yoast">Yoast SEO</SelectItem>
                    <SelectItem value="rankmath">RankMath</SelectItem>
                    <SelectItem value="seopress">SEOPress</SelectItem>
                    <SelectItem value="none">None / native</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {testResult && <p className="text-xs text-brand">{testResult}</p>}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={
                  !form.site_url || !form.username || !form.app_password || testMutation.isPending
                }
                onClick={() => testMutation.mutate()}
              >
                {testMutation.isPending ? "Testing…" : "Test connection"}
              </Button>
              <Button
                size="sm"
                disabled={
                  !form.site_url || !form.username || !form.app_password || addSite.isPending
                }
                onClick={() => addSite.mutate()}
              >
                {addSite.isPending ? "Saving…" : "Connect site"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
