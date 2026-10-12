import { getPaddleEnvironment } from "@/lib/paddle";
import { useI18n } from "@/hooks/useI18n";

export function PaymentTestModeBanner() {
  const { t, tr } = useI18n();
  if (getPaddleEnvironment() !== "sandbox") return null;

  return (
    <div className="w-full border-b border-orange-300 bg-orange-100 px-4 py-2 text-center text-sm text-orange-800">
      {tr("paymentTestModeBanner.allPaymentsMadeInThe", {
        a: (
          <a
            href="https://docs.lovable.dev/features/payments#test-and-live-environments"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline"
          >
            {t("paymentTestModeBanner.readMore")}
          </a>
        ),
      })}
    </div>
  );
}
