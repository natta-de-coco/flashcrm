import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CreditCard, ExternalLink, Sparkles, CheckCircle2, ShieldCheck, Unlink } from "lucide-react";
import { toast } from "sonner";

import { useTenant } from "@/hooks/useTenant";
import { formatDayUnambiguous } from "@/lib/locale";
import { useI18n } from "@/hooks/useI18n";
import { hasMessage, type MessageKey } from "@/lib/i18n";
import {
  createPortalSession,
  createStripeCheckoutSessionFn,
  disconnectPaddleFn,
  walkTestSubscriptionFn,
} from "@/utils/payments.functions";
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
  const { t } = useI18n();

  const stripeCheckoutFn = useServerFn(createStripeCheckoutSessionFn);
  const portalFn = useServerFn(createPortalSession);
  const disconnectPaddle = useServerFn(disconnectPaddleFn);
  const walkTestSub = useServerFn(walkTestSubscriptionFn);

  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [disconnectLoading, setDisconnectLoading] = useState(false);
  const [testWalkLoading, setTestWalkLoading] = useState(false);

  // Detect returning successful checkout once, then refresh tenant state.
  useQuery({
    queryKey: ["checkout-return-refresh"],
    queryFn: async () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("checkout") === "success") {
        toast.success(t("settings.billing.activated"));
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
    ? formatDayUnambiguous(tenant.subscription_renews_at)
    : null;
  const hasSubscription =
    tenant.subscription_status === "active" || tenant.subscription_status === "past_due";

  const isPaddleSubscriber = Boolean(tenant.paddle_subscription_id || tenant.paddle_customer_id);
  const isStripeSubscriber = Boolean(tenant.stripe_subscription_id || tenant.stripe_customer_id);

  const subscribeStripe = async (plan: "flash_monthly" | "flash_yearly") => {
    setCheckoutLoading(true);
    try {
      const res = await stripeCheckoutFn({
        data: {
          plan,
          origin: window.location.origin,
        },
      });
      if (res.url) {
        window.location.href = res.url;
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not initiate Stripe checkout");
    } finally {
      setCheckoutLoading(false);
    }
  };

  const openPortal = async () => {
    setPortalLoading(true);
    try {
      const { url } = await portalFn();
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("settings.billing.portalFailed"));
    } finally {
      setPortalLoading(false);
    }
  };

  const handleDisconnectPaddle = async () => {
    setDisconnectLoading(true);
    try {
      await disconnectPaddle();
      toast.success("Paddle disconnected. New checkouts will process via Stripe.");
      await refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to disconnect Paddle");
    } finally {
      setDisconnectLoading(false);
    }
  };

  const handleTestWalk = async () => {
    setTestWalkLoading(true);
    try {
      const res = await walkTestSub({ data: { plan: "flash_monthly" } });
      toast.success(
        `Test subscription active! Invoice #${res.docNumber} created and saved in Sales.`,
        { duration: 5000 },
      );
      await refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to run test subscription walk");
    } finally {
      setTestWalkLoading(false);
    }
  };

  return (
    <Card>
      <PaymentTestModeBanner />
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" /> {t("settings.billing.title")}
          </CardTitle>
          <div className="flex items-center gap-2">
            {isStripeSubscriber && (
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
                <ShieldCheck className="me-1 h-3 w-3" /> Stripe
              </Badge>
            )}
            {isPaddleSubscriber && !isStripeSubscriber && (
              <Badge variant="outline" className="border-blue-500/40 text-blue-600 dark:text-blue-400">
                Paddle (Legacy)
              </Badge>
            )}
          </div>
        </div>
        <CardDescription>{t("settings.billing.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={status?.variant ?? "secondary"}>
            {hasMessage(`settings.billing.status.${tenant.subscription_status}`)
              ? t(`settings.billing.status.${tenant.subscription_status}` as MessageKey)
              : t("settings.billing.status.trial")}
          </Badge>
          {renewsAt && (
            <span className="text-sm text-muted-foreground">
              {tenant.subscription_status === "trial"
                ? t("settings.billing.trialEnds", { date: renewsAt })
                : t("settings.billing.renews", { date: renewsAt })}
            </span>
          )}
        </div>

        {tenant.subscription_status === "past_due" && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {t("settings.billing.pastDue")}
          </p>
        )}
        {tenant.subscription_status === "canceled" && (
          <p className="rounded-md border p-3 text-sm text-muted-foreground">
            {t("settings.billing.canceledNote")}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {!hasSubscription && (
            <>
              <Button onClick={() => subscribeStripe("flash_monthly")} disabled={checkoutLoading}>
                <Sparkles className="me-2 h-4 w-4" />
                {checkoutLoading
                  ? t("settings.billing.openingCheckout")
                  : tenant.subscription_status === "canceled"
                    ? t("settings.billing.resubscribe")
                    : t("settings.billing.monthly")}
              </Button>
              <Button
                variant="outline"
                onClick={() => subscribeStripe("flash_yearly")}
                disabled={checkoutLoading}
              >
                {t("settings.billing.yearly")}
              </Button>
            </>
          )}

          {hasSubscription && (
            <Button variant="outline" onClick={openPortal} disabled={portalLoading}>
              <ExternalLink className="me-2 h-4 w-4" />
              {portalLoading ? t("settings.billing.opening") : t("settings.billing.manage")}
            </Button>
          )}

          {isPaddleSubscriber && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDisconnectPaddle}
              disabled={disconnectLoading}
              className="text-xs text-muted-foreground hover:text-destructive"
            >
              <Unlink className="me-1 h-3.5 w-3.5" />
              Disconnect Paddle
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">{t("settings.billing.selfService")}</p>

        {/* Developer / Acceptance walkthrough utility */}
        <div className="mt-4 rounded-lg border border-dashed border-border/80 bg-muted/30 p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-semibold text-foreground">Stripe Integration & Verification</span>
              <p className="text-muted-foreground">
                Walk a test subscription through from checkout simulation to a saved invoice.
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleTestWalk}
              disabled={testWalkLoading}
              className="text-xs"
            >
              <CheckCircle2 className="me-1 h-3.5 w-3.5 text-emerald-600" />
              {testWalkLoading ? "Walking test subscription…" : "Walk Test Subscription (Stripe)"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
