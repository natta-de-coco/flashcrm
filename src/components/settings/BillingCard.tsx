import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CreditCard, ExternalLink, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { useTenant } from "@/hooks/useTenant";
import { useAuth } from "@/hooks/useAuth";
import { usePaddleCheckout } from "@/hooks/usePaddleCheckout";
import { createPortalSession } from "@/utils/payments.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";

const STATUS_LABELS: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  trial: { label: "Free trial", variant: "secondary" },
  active: { label: "Active", variant: "default" },
  past_due: { label: "Payment issue", variant: "destructive" },
  canceled: { label: "Canceled", variant: "outline" },
};

export function BillingCard() {
  const { tenant, refresh } = useTenant();
  const { user } = useAuth();
  const { openCheckout, loading: checkoutLoading } = usePaddleCheckout();
  const portalFn = useServerFn(createPortalSession);
  const [portalLoading, setPortalLoading] = useState(false);

  // Detect a returning successful checkout once, then refresh tenant state.
  useQuery({
    queryKey: ["checkout-return-refresh"],
    queryFn: async () => {
      if (new URLSearchParams(window.location.search).get("checkout") === "success") {
        toast.success("Subscription activated — welcome aboard!");
        await refresh();
        window.history.replaceState({}, "", window.location.pathname);
      }
      return true;
    },
    staleTime: Infinity,
  });

  if (!tenant) return null;
  const status = STATUS_LABELS[tenant.subscription_status] ?? STATUS_LABELS["trial"];
  const renewsAt = tenant.subscription_renews_at
    ? new Date(tenant.subscription_renews_at).toLocaleDateString()
    : null;
  const hasSubscription =
    tenant.subscription_status === "active" || tenant.subscription_status === "past_due";

  const subscribe = (priceId: "flash_monthly" | "flash_yearly") =>
    openCheckout({
      priceId,
      quantity: 1,
      ...(user?.email ? { customerEmail: user.email } : {}),
      customData: { userId: user?.id ?? "", tenantId: tenant.id },
    });

  const openPortal = async () => {
    setPortalLoading(true);
    try {
      const { url } = await portalFn();
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open the billing portal");
    } finally {
      setPortalLoading(false);
    }
  };

  return (
    <Card>
      <PaymentTestModeBanner />
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" /> Subscription &amp; Billing
        </CardTitle>
        <CardDescription>
          Flas WhatsApp Tool — normally $30/month. Launch offer: $20/month for your first six
          months, or $240 a year instead of $360. Manage or cancel anytime.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={status?.variant ?? "secondary"}>{status?.label ?? "Trial"}</Badge>
          {renewsAt && (
            <span className="text-sm text-muted-foreground">
              {tenant.subscription_status === "trial" ? "Trial ends" : "Renews"}: {renewsAt}
            </span>
          )}
        </div>

        {tenant.subscription_status === "past_due" && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            Your last payment failed. Update your payment method to keep access — retries are
            running automatically for a few days.
          </p>
        )}
        {tenant.subscription_status === "canceled" && (
          <p className="rounded-md border p-3 text-sm text-muted-foreground">
            Your subscription is canceled. Resubscribe to restore full access.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {!hasSubscription && (
            <>
              <Button onClick={() => subscribe("flash_monthly")} disabled={checkoutLoading}>
                <Sparkles className="mr-2 h-4 w-4" />
                {checkoutLoading
                  ? "Opening checkout…"
                  : tenant.subscription_status === "canceled"
                    ? "Resubscribe — $20/mo"
                    : "Monthly — $20/mo (was $30, 1 month free)"}
              </Button>
              <Button
                variant="outline"
                onClick={() => subscribe("flash_yearly")}
                disabled={checkoutLoading}
              >
                Yearly — $240/year (was $360)
              </Button>
            </>
          )}
          {hasSubscription && (
            <Button variant="outline" onClick={openPortal} disabled={portalLoading}>
              <ExternalLink className="mr-2 h-4 w-4" />
              {portalLoading ? "Opening…" : "Manage or cancel subscription"}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Cancellation is self-service from the billing portal — you keep access until the end of
          the paid period.
        </p>
      </CardContent>
    </Card>
  );
}
