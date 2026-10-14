/**
 * src/routes/unsubscribe.tsx
 *
 * Public One-Click Unsubscribe Handler (RFC 8058, GDPR & CAN-SPAM compliant).
 * Validates HMAC token, revokes consent across leads and contacts, and displays clean confirmation.
 */

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { CheckCircle2, ShieldAlert, Sparkles } from "lucide-react";
import { z } from "zod";

const processUnsubscribeFn = createServerFn({ method: "POST" })
  .validator((d: { token: string }) => z.object({ token: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const { applyUnsubscribe } = await import("@/lib/unsubscribe.server");
    return await applyUnsubscribe(data.token);
  });

type UnsubscribeLoaderData =
  { ok: true; email: string; error?: never } | { ok: false; error: string; email?: never };

interface UnsubscribeSearch {
  token?: string;
}

export const Route = createFileRoute("/unsubscribe")({
  validateSearch: (search: Record<string, unknown>): UnsubscribeSearch => ({
    token: typeof search["token"] === "string" ? (search["token"] as string) : "",
  }),
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: async ({ deps }): Promise<UnsubscribeLoaderData> => {
    const token = deps.token;
    if (!token) {
      return { ok: false, error: "No unsubscribe token provided" };
    }
    const res = await processUnsubscribeFn({ data: { token } });
    if (!res.ok) {
      return { ok: false, error: res.error || "Failed to process unsubscribe" };
    }
    return { ok: true, email: res.email || "" };
  },
  head: () => ({
    meta: [
      { title: "Unsubscribe from Marketing Emails — Flas CRM" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: UnsubscribePage,
});

function UnsubscribePage() {
  const data = Route.useLoaderData();

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
      <Card className="w-full max-w-md shadow-lg border-border">
        <CardHeader className="text-center">
          {data.ok ? (
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
              <CheckCircle2 className="h-6 w-6" />
            </div>
          ) : (
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400">
              <ShieldAlert className="h-6 w-6" />
            </div>
          )}

          <CardTitle className="text-xl">
            {data.ok ? "You have been unsubscribed" : "Unsubscribe link issue"}
          </CardTitle>
          <CardDescription>
            {data.ok
              ? `You will no longer receive marketing communications at ${data.email}.`
              : data.error || "The link may be expired or already used."}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4 text-center">
          {data.ok ? (
            <p className="text-sm text-muted-foreground">
              Your preferences have been updated immediately across our systems. You may still
              receive critical transactional notices regarding your active account or orders.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              If you wish to manage your email preferences, please contact support or reply to the
              email you received.
            </p>
          )}

          <div className="pt-2">
            <Button variant="outline" asChild className="w-full">
              <a href="/">Return to Homepage</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
