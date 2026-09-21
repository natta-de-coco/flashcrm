import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { formatMomentUnambiguous } from "@/lib/locale";

/**
 * Super-admin only. Global email delivery log across every tenant.
 * RLS filters this for non-super-admins automatically (they see nothing),
 * so the route is safe even if a regular admin lands here — they'll see 0 rows.
 */
export const Route = createFileRoute("/_authenticated/companies/emails")({
  head: () => ({
    meta: [
      { title: "Email delivery log — Flas CRM (super admin)" },
      {
        name: "description",
        content: "Every email dispatched across every tenant, with delivery + bounce status.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SuperAdminEmailLog,
});

type LogRow = {
  id: string;
  tenant_id: string | null;
  recipient: string;
  subject: string | null;
  template: string | null;
  provider: string;
  status: string;
  error: string | null;
  created_at: string;
};

type OtpRow = {
  id: string;
  email: string;
  ip_address: string | null;
  kind: string;
  status: string;
  reject_reason: string | null;
  created_at: string;
};

function statusBadge(status: string) {
  const cls: Record<string, string> = {
    sent: "bg-emerald-100 text-emerald-800",
    delivered: "bg-emerald-100 text-emerald-800",
    queued: "bg-slate-100 text-slate-800",
    opened: "bg-blue-100 text-blue-800",
    clicked: "bg-blue-100 text-blue-800",
    bounced: "bg-red-100 text-red-800",
    complained: "bg-red-100 text-red-800",
    rejected: "bg-red-100 text-red-800",
    failed: "bg-red-100 text-red-800",
  };
  return <Badge className={cls[status] ?? "bg-slate-100 text-slate-800"}>{status}</Badge>;
}

function SuperAdminEmailLog() {
  const { isSuperAdmin, loading } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [otps, setOtps] = useState<OtpRow[]>([]);
  const [filter, setFilter] = useState("");
  const [loadingRows, setLoadingRows] = useState(true);

  useEffect(() => {
    if (!loading && !isSuperAdmin) {
      // RLS will hide the rows anyway, but a cleaner UX is to bounce them
      void navigate({ to: "/dashboard", replace: true });
    }
  }, [loading, isSuperAdmin, navigate]);

  useEffect(() => {
    if (!isSuperAdmin) return;
    let cancelled = false;
    void (async () => {
      setLoadingRows(true);
      const [emailsRes, otpsRes] = await Promise.all([
        supabase
          .from("email_delivery_log")
          .select(
            "id, tenant_id, recipient, subject, template, provider, status, error, created_at",
          )
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("otp_attempts")
          .select("id, email, ip_address, kind, status, reject_reason, created_at")
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      if (cancelled) return;
      setRows((emailsRes.data as LogRow[] | null) ?? []);
      setOtps((otpsRes.data as OtpRow[] | null) ?? []);
      setLoadingRows(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin]);

  if (loading || !isSuperAdmin) {
    return <main className="p-6 text-sm text-muted-foreground">Checking access…</main>;
  }

  const filtered = filter
    ? rows.filter(
        (r) =>
          r.recipient.toLowerCase().includes(filter.toLowerCase()) ||
          (r.subject ?? "").toLowerCase().includes(filter.toLowerCase()) ||
          (r.template ?? "").toLowerCase().includes(filter.toLowerCase()),
      )
    : rows;

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-[1.75rem] font-bold leading-tight sm:text-3xl">Email delivery log</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every mail dispatched across every tenant. Super-admin only. Use this to troubleshoot
          missing OTPs, bounced verification emails, or complaints.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent OTP / verification attempts</CardTitle>
          <CardDescription>
            Server-side rate limits: 60s cooldown, 5/hour and 20/day per email+kind. Rejections
            appear here so you can spot brute-force or looped signups.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reject reason</TableHead>
                  <TableHead>IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {otps.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-xs text-muted-foreground">
                      {loadingRows ? "Loading…" : "No OTP attempts recorded yet."}
                    </TableCell>
                  </TableRow>
                ) : (
                  otps.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {formatMomentUnambiguous(o.created_at)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{o.email}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{o.kind}</Badge>
                      </TableCell>
                      <TableCell>{statusBadge(o.status)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {o.reject_reason ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{o.ip_address ?? "—"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Email delivery events</CardTitle>
          <CardDescription>
            Provider-side status: <em>sent</em> means dispatched; <em>bounced</em> /{" "}
            <em>complained</em> / <em>failed</em> means the recipient will not have received it.
            Filter by recipient or subject.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Filter by recipient / subject / template"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="max-w-md"
          />
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Template</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-xs text-muted-foreground">
                      {loadingRows ? "Loading…" : "No email events recorded yet."}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {formatMomentUnambiguous(r.created_at)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.tenant_id ? r.tenant_id.slice(0, 8) : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.recipient}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{r.template ?? "—"}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">{r.provider}</TableCell>
                      <TableCell>{statusBadge(r.status)}</TableCell>
                      <TableCell className="max-w-xs truncate text-xs text-destructive">
                        {r.error ?? ""}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
