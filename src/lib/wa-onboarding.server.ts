/** Read-only credential check. This does not prove webhook delivery or sending permission. */
export async function verifyWhatsAppNumber(phoneNumberId: string, token: string) {
  let response: Response;
  try {
    response = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}?fields=id,display_phone_number,verified_name`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
        redirect: "error",
      },
    );
  } catch {
    throw new Error("Meta could not be reached. Nothing was saved. Try again shortly.");
  }
  // Never relay provider errors: they can contain credentials or private asset data.
  if (!response.ok) {
    throw new Error(
      response.status === 429 || response.status >= 500
        ? "Meta is temporarily unavailable. Nothing was saved. Try again shortly."
        : "Meta could not verify access to this WhatsApp number. Check the number ID and token permissions. Nothing was saved.",
    );
  }
  const body: unknown = await response.json().catch(() => null);
  if (
    !body ||
    typeof body !== "object" ||
    !("id" in body) ||
    body.id !== phoneNumberId ||
    !("display_phone_number" in body) ||
    typeof body.display_phone_number !== "string" ||
    !body.display_phone_number.trim() ||
    body.display_phone_number.length > 40
  ) {
    throw new Error("Meta did not return a valid WhatsApp phone number. Nothing was saved.");
  }
  return { displayPhone: body.display_phone_number.trim() };
}
