import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { canReceiveLeadNotifications } from "./notification-access";
export type WorkspaceNotification = {
  id: string;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
};
interface Result<T> {
  data: T | null;
  error: { message: string } | null;
  count?: number | null;
}
interface Query extends PromiseLike<Result<WorkspaceNotification[]>> {
  select: (columns: string, options?: { count?: "exact"; head?: boolean }) => Query;
  update: (value: { read_at: string }) => Query;
  eq: (column: string, value: unknown) => Query;
  is: (column: string, value: null) => Query;
  in: (column: string, value: string[]) => Query;
  order: (column: string, options: { ascending: boolean }) => Query;
  limit: (limit: number) => Query;
}
type NotificationDb = { from: (table: string) => Query };
async function ownScope(context: { userId: string; supabase: unknown }) {
  const client = context.supabase as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (
          column: string,
          value: string,
        ) => {
          maybeSingle: () => Promise<
            Result<{ tenant_id: string | null; staff_role: string | null }>
          >;
        };
      };
    };
  };
  const { data, error } = await client
    .from("profiles")
    .select("tenant_id, staff_role")
    .eq("id", context.userId)
    .maybeSingle();
  if (error) throw new Error("Your notification access could not be checked.");
  if (!data?.tenant_id || !canReceiveLeadNotifications(data.staff_role))
    throw new Error("Lead notifications are not available for this account.");
  return data.tenant_id;
}
export const listOwnNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const tenantId = await ownScope(context);
    const client = context.supabase as unknown as NotificationDb;
    const [entries, count] = await Promise.all([
      client
        .from("workspace_notifications")
        .select("id, title, body, created_at, read_at")
        .eq("tenant_id", tenantId)
        .eq("recipient_user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(20),
      client
        .from("workspace_notifications")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("recipient_user_id", context.userId)
        .is("read_at", null),
    ]);
    if (entries.error || count.error || count.count === null || count.count === undefined)
      throw new Error(
        "Notifications could not be loaded. A FLAS administrator may need to finish database setup.",
      );
    return { entries: entries.data ?? [], unreadCount: count.count };
  });
export const markOwnNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) =>
    z
      .object({ ids: z.array(z.string().uuid()).min(1).max(20) })
      .strict()
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await ownScope(context);
    const client = context.supabase as unknown as NotificationDb;
    const { data: updated, error } = await client
      .from("workspace_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("recipient_user_id", context.userId)
      .in("id", data.ids)
      .select("id");
    if (error) throw new Error("Notifications could not be marked as read.");
    return { updatedIds: (updated ?? []).map((row) => row.id) };
  });
