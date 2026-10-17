import { z } from "zod";
export const LeadAlertPreferencesSchema = z
  .object({
    leadAlertsEnabled: z.boolean(),
    alertEmailAddresses: z
      .array(z.string().trim().toLowerCase().email())
      .max(10)
      .transform((emails) => [...new Set(emails)]),
    alertWhatsappEnabled: z.literal(false, {
      errorMap: () => ({
        message:
          "WhatsApp lead alerts are unavailable until the approved messaging pipeline is configured.",
      }),
    }),
    alertWhatsappPhone: z.string().trim().max(30).nullable().optional(),
  })
  .strict();
