import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CreditCard, ExternalLink, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { useTenant } from "@/hooks/useTenant";
import { formatDayUnambiguous } from "@/lib/locale";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { hasMessage, type MessageKey } from "@/lib/i18n";
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
  const { t } = useI18n();
  const { user } = useAuth();
  const { openCheckout, loading: checkoutLoading } = usePaddleCheckout();
  const portalFn = useServerFn(createPortalSession);
  const [portalLoading, setPortalLoading] = useState(false);

  // Detect a returning successful checkout once, then refresh tenant state.
  useQuery({
    queryKey: ["checkout-return-refresh"],
    queryFn: async () => {
      if (new URLSearchParams(window.location.search).get("checkout") === "success") {
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
      toast.error(e instanceof Error ? e.message : t("settings.billing.portalFailed"));
    } finally {
      setPortalLoading(false);
    }
  };

  return (
    <Card>
      <PaymentTestModeBanner />
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" /> {t("settings.billing.title")}
        </CardTitle>
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

        <div className="flex flex-wrap gap-2">
          {!hasSubscription && (
            <>
              <Button onClick={() => subscribe("flash_monthly")} disabled={checkoutLoading}>
                <Sparkles className="me-2 h-4 w-4" />
                {checkoutLoading
                  ? t("settings.billing.openingCheckout")
                  : tenant.subscription_status === "canceled"
                    ? t("settings.billing.resubscribe")
                    : t("settings.billing.monthly")}
              </Button>
              <Button
                variant="outline"
                onClick={() => subscribe("flash_yearly")}
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
        </div>
        <p className="text-xs text-muted-foreground">{t("settings.billing.selfService")}</p>
      </CardContent>
    </Card>
  );
}
