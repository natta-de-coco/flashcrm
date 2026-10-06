// What a workspace may save as its region. Built from the same lists the
// Settings pickers show, so the server accepts exactly what the screen offers.
import { COUNTRIES, CURRENCIES, LANGUAGES, isValidTimeZone } from "@/lib/locale";
import { z } from "zod";

export const RegionSchema = z.object({
  country: z.enum(COUNTRIES.map((c) => c.code) as [string, ...string[]]),
  currency: z.enum(CURRENCIES.map((c) => c.code) as [string, ...string[]]),
  locale: z.enum(LANGUAGES.map((l) => l.code) as [string, ...string[]]),
  // Any string used to be accepted here, and a zone the engine cannot format in
  // silently broke every date the workspace showed.
  timezone: z
    .string()
    .min(1)
    .max(64)
    .refine(isValidTimeZone, { message: "Choose a timezone from the list." }),
});
