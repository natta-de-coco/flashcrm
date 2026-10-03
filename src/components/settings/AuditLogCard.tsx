import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listAuditLog } from "@/lib/audit.functions";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

const ACTION_LABELS: Record<string, string> = {
  "consent.capture": "Consent captured",
  "lead.route": "Lead routed",
  "message.send": "Message sent",
  "message.template_send": "Template sent",
  "message.blocked": "Message blocked",
  "contacts.import": "Contacts imported",
  "contacts.export": "Contacts exported",
  "conversations.export": "Conversations exported",
  "transcript.export": "Transcript exported",
  "conversation.assign": "Chat assigned",
  "conversation.tag": "Tags changed",
  "conversation.status": "Status changed",
  "reminder.create": "Reminder set",
  "api_key.create": "API key created",
  "api_key.revoke": "API key revoked",
  "api.access": "External API access",
  "webhook.signature_rejected": "Webhook rejected",
  "company.subscription_update": "Subscription changed",
};

/** Append-only compliance trail for this workspace, newest first. */
export function AuditLogCard() {
  const listFn = useServerFn(listAuditLog);
  const entries = useQuery({
    queryKey: ["audit-log"],
    queryFn: () => listFn({ data: { limit: 100 } }),
    refetchInterval: 30_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Audit log</CardTitle>
        <CardDescription>
          Every consent capture, routing decision, import/export and message action — kept for
          compliance and troubleshooting. Entries cannot be edited or deleted.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {(entries.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No events recorded yet.</p>
        ) : (
          <div className="max-h-96 space-y-1.5 overflow-y-auto">
            {(entries.data ?? []).map((e) => (
              <div
                key={e.id}
                className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs"
              >
                <Badge variant="secondary" className="text-[10px]">
                  {ACTION_LABELS[e.action] ?? e.action}
                </Badge>
                <span className="text-muted-foreground">
                  {e.actor_label ?? "system"}
                  {e.entity_id ? ` · ${e.entity_id.slice(0, 18)}` : ""}
                </span>
                <span className="ms-auto shrink-0 text-muted-foreground">
                  {new Date(e.created_at).toLocaleString()}
                </span>
                {e.action === "message.blocked" && (
                  <span className="w-full text-destructive">
                    {((e.details as { reasons?: string[] })?.reasons ?? []).join(" ")}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
