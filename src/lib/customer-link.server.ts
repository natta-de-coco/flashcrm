// Where a link sent to a customer may point: this deployment, and nowhere else.
import { resolveAllowedOrigin } from "@/lib/oauth.server";

/**
 * The origin to build a customer's link on.
 *
 * The browser says which origin it is on, and that used to be put into the
 * customer's message as given. It is accepted only when it is one of the
 * deployment's configured origins, or the very origin this request was made
 * to -- so a crafted request cannot make the business's WhatsApp number send
 * a link to somewhere else.
 */
export function customerLinkOrigin(claimed: string, requestUrl: string | null | undefined): string {
  const configured = resolveAllowedOrigin(claimed);
  if (configured) return configured;
  try {
    const own = new URL(requestUrl ?? "");
    const wanted = new URL(claimed);
    if (
      own.protocol === "https:" &&
      own.origin === wanted.origin &&
      !wanted.username &&
      !wanted.password
    ) {
      return own.origin;
    }
  } catch {
    /* falls through to the refusal */
  }
  throw new Error("This link does not point to this FLAS site, so nothing was sent.");
}
