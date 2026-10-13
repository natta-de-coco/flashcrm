// What FLAS knows about one outbound WhatsApp message, and what it may claim.
//
// Pure rules, no database and no network, so they can be tested exhaustively:
//  - which status a message may move to (never backwards),
//  - what a provider answer means (accepted, refused, or not known),
//  - why a send was refused, as a stable code the interface can translate.

/**
 * The life of an outbound message.
 *
 *  sending      the row is saved; the provider has not answered yet
 *  unconfirmed  the provider call ended without an answer (timeout, dropped
 *               connection). The customer may or may not have received it.
 *  sent         the provider accepted it and gave it an id. Not "delivered".
 *  delivered    the provider reported it reached the customer's device
 *  read         the provider reported the customer opened it
 *  failed       the provider refused it, or later reported it undeliverable
 */
export const WA_MESSAGE_STATUSES = [
  "sending",
  "unconfirmed",
  "sent",
  "delivered",
  "read",
  "failed",
] as const;
export type WaMessageStatus = (typeof WA_MESSAGE_STATUSES)[number];

const RANK: Record<WaMessageStatus, number> = {
  sending: 0,
  unconfirmed: 1,
  sent: 2,
  delivered: 3,
  read: 4,
  // Terminal, but only reachable before the message is known to have arrived.
  failed: 5,
};

/** The statuses Meta reports in a delivery receipt. */
export type WaProviderStatus = "sent" | "delivered" | "read" | "failed";

/** A status the provider reports in a webhook, or null for anything else. */
export function providerStatus(raw: string | null | undefined): WaProviderStatus | null {
  return raw === "sent" || raw === "delivered" || raw === "read" || raw === "failed" ? raw : null;
}

/**
 * The statuses a message may currently have for `incoming` to be applied.
 *
 * Webhooks arrive late, twice and out of order. Applying whatever arrives let
 * a late "sent" or "delivered" overwrite "read". A status is applied only
 * when it moves the message forward; "failed" never overwrites a message the
 * provider already reported as delivered or read.
 */
export function statusesThatMayBecome(incoming: WaMessageStatus): WaMessageStatus[] {
  if (incoming === "failed") return ["sending", "unconfirmed", "sent"];
  return WA_MESSAGE_STATUSES.filter(
    (current) => current !== "failed" && RANK[current] < RANK[incoming],
  );
}

export function mayAdvance(current: string | null | undefined, incoming: WaMessageStatus): boolean {
  return statusesThatMayBecome(incoming).includes(current as WaMessageStatus);
}

/** Why a send did not go through, in terms a person can act on. */
export type WaFailureReason =
  | "window_closed"
  | "credentials"
  | "permission"
  | "template"
  | "rate_limited"
  | "quality_restricted"
  | "recipient_unreachable"
  | "recipient_not_allowed"
  | "recipient_opted_out"
  | "number_not_registered"
  | "billing"
  | "invalid_request"
  | "provider_unavailable"
  | "unknown";

/** Meta's error codes, grouped by what the person has to do about them. */
const REASON_BY_CODE: Record<number, WaFailureReason> = {
  // Authorization
  0: "credentials",
  190: "credentials",
  3: "permission",
  10: "permission",
  131005: "permission",
  // Throttling
  4: "rate_limited",
  80007: "rate_limited",
  130429: "rate_limited",
  131056: "rate_limited",
  // Integrity and quality
  368: "quality_restricted",
  130497: "quality_restricted",
  131031: "quality_restricted",
  131048: "quality_restricted",
  131049: "quality_restricted",
  131064: "quality_restricted",
  // The conversation
  131047: "window_closed",
  // The recipient
  131026: "recipient_unreachable",
  131021: "recipient_unreachable",
  130403: "recipient_unreachable",
  131030: "recipient_not_allowed",
  131050: "recipient_opted_out",
  // The business number
  33: "number_not_registered",
  131037: "number_not_registered",
  131045: "number_not_registered",
  133010: "number_not_registered",
  131042: "billing",
  // Templates
  132000: "template",
  132001: "template",
  132005: "template",
  132007: "template",
  132012: "template",
  132015: "template",
  132016: "template",
  131063: "template",
  // The request itself
  100: "invalid_request",
  131008: "invalid_request",
  131009: "invalid_request",
  131051: "invalid_request",
  135000: "invalid_request",
  // Meta's side
  1: "provider_unavailable",
  2: "provider_unavailable",
  131000: "provider_unavailable",
  131016: "provider_unavailable",
  131057: "provider_unavailable",
};

export function failureReasonForCode(code: number | null | undefined): WaFailureReason {
  if (code == null) return "unknown";
  if (REASON_BY_CODE[code]) return REASON_BY_CODE[code];
  // 200–299 is Meta's documented range for missing API permissions.
  if (code >= 200 && code <= 299) return "permission";
  return "unknown";
}

/**
 * The English for each reason. The interface translates by reason code and
 * falls back to this, so a reason added here is never shown as a raw code.
 */
export const WA_FAILURE_TEXT: Record<WaFailureReason, string> = {
  // A template may be sent outside the window, but sending one does not
  // re-open it: only a new message from the customer does.
  window_closed:
    "The 24-hour WhatsApp reply window has closed. An approved template can still be sent; free-text replies become available after the customer sends a new message.",
  credentials: "The connected WhatsApp account needs to be reconnected by a company admin.",
  permission:
    "The connected WhatsApp account is missing a permission this message needs. A company admin must reconnect it and approve every permission.",
  template:
    "WhatsApp refused this template. Check that it is approved in this language, not paused, and that every variable is filled in.",
  rate_limited:
    "WhatsApp is limiting how fast this number can send right now. Wait a few minutes before trying again.",
  quality_restricted:
    "WhatsApp has restricted this number or this message because of quality or policy limits. Check the number's status in Meta before sending more.",
  recipient_unreachable:
    "WhatsApp could not reach this number. Check that the customer uses WhatsApp on it.",
  recipient_not_allowed:
    "This WhatsApp account is still in test mode and can only message its approved test recipients.",
  recipient_opted_out: "This customer has opted out of marketing messages on WhatsApp.",
  number_not_registered:
    "This business number is not registered or approved on WhatsApp yet. A company admin must finish its setup in Meta.",
  billing:
    "WhatsApp refused the message because of a payment problem on the Meta business account.",
  invalid_request:
    "WhatsApp did not accept this message as written. Check the customer's number and the message content.",
  provider_unavailable:
    "WhatsApp is temporarily unavailable. The message was not sent; try again shortly.",
  unknown: "WhatsApp did not accept this message. Ask a company admin to check the connection.",
};

/** What happened when FLAS asked the provider to send a message. */
export type WaSendOutcome =
  | { state: "accepted"; waMessageId: string }
  | {
      /** The provider answered and said no. The customer did not receive it. */
      state: "rejected";
      reason: WaFailureReason;
      message: string;
      providerCode: number | null;
    }
  | {
      /**
       * No usable answer: the request timed out, the connection dropped, or
       * the provider returned something unreadable. The customer may have
       * received the message, so it must not be sent again automatically.
       */
      state: "unconfirmed";
      message: string;
    };

export const WA_UNCONFIRMED_TEXT =
  "WhatsApp did not confirm whether this message was sent. Do not send it again yet: check with the customer, or wait for the delivery receipt.";

type ProviderBody = {
  messages?: Array<{ id?: unknown }>;
  error?: { code?: unknown };
};

function parseProviderBody(rawBody: string): ProviderBody | null {
  try {
    return JSON.parse(rawBody) as ProviderBody;
  } catch {
    return null;
  }
}

/**
 * Reads a provider HTTP answer.
 *
 * Only an explicit error from Meta counts as a refusal. A response with no
 * readable error -- a gateway page, an empty body, a success without a message
 * id -- says nothing reliable about what happened to the message.
 */
export function readSendResponse(httpStatus: number, rawBody: string): WaSendOutcome {
  const parsed = parseProviderBody(rawBody);

  if (httpStatus >= 200 && httpStatus < 300) {
    const id = parsed?.messages?.[0]?.id;
    if (typeof id === "string" && id) return { state: "accepted", waMessageId: id };
    return { state: "unconfirmed", message: WA_UNCONFIRMED_TEXT };
  }

  const error = parsed?.error;
  if (!error) return { state: "unconfirmed", message: WA_UNCONFIRMED_TEXT };
  const providerCode = typeof error.code === "number" ? error.code : null;
  const reason = failureReasonForCode(providerCode);
  return { state: "rejected", reason, message: WA_FAILURE_TEXT[reason], providerCode };
}

/**
 * The digits WhatsApp addresses a customer by, or why there are none.
 *
 * The canonical form is the one the database uses for contact identities:
 * digits only, a leading "00" dropped. A number written the national way
 * ("050 123 4567") has no country in it; it is completed with the workspace's
 * own calling code, and only when that is unambiguous. Anything else is
 * refused rather than guessed, because a wrong guess messages a stranger.
 *
 * A number with no "+" and no leading zero is accepted only when it already
 * begins with the workspace's country code. Otherwise it may be a local
 * number written short ("415 555 2671") or a foreign one written without its
 * plus ("65 6123 4567"): both are ten digits and only one is the person
 * meant. Numbers FLAS records from WhatsApp itself are stored with their plus,
 * so this only ever turns away something a person typed or imported.
 */
export function resolveRecipientNumber(
  raw: string | null | undefined,
  workspaceCallingCode: string | null | undefined,
): { ok: true; digits: string; international: string } | { ok: false; reason: string } {
  const typed = (raw ?? "").trim();
  if (!typed) return { ok: false, reason: "This contact has no phone number." };
  const hasPlus = typed.startsWith("+");
  let digits = typed.replace(/[^0-9]/g, "");
  const hadInternationalPrefix = hasPlus || digits.startsWith("00");
  digits = digits.replace(/^00/, "");

  const code = (workspaceCallingCode ?? "").replace(/[^0-9]/g, "");

  if (hadInternationalPrefix) {
    if (code && digits.startsWith(code + "0")) {
      digits = code + digits.slice(code.length).replace(/^0+/, "");
    }
  } else {
    const noCountry = {
      ok: false as const,
      reason:
        "This number is written without a country code. Save it in international form, for example +971 50 123 4567.",
    };
    if (digits.startsWith("0")) {
      // A national trunk prefix: the country is not in the number.
      if (!code) return noCountry;
      digits = code + digits.replace(/^0+/, "");
    } else if (!code || !digits.startsWith(code)) {
      // Nothing says which country this is in, and it is not this one's.
      return noCountry;
    }
  }

  // E.164: at most 15 digits, and no real number is shorter than 8 with its
  // country code.
  if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) {
    return {
      ok: false,
      reason:
        "This is not a complete phone number. Save it in international form, for example +971 50 123 4567.",
    };
  }
  return { ok: true, digits, international: `+${digits}` };
}

// ── What is kept about a message beyond its status ─────────────────────────

/** Where a message row came from. Matches the check on messages.origin. */
export const MESSAGE_ORIGINS = [
  "inbox",
  "template",
  "document",
  "assistant",
  "webhook",
  "widget",
  "import",
  "system",
] as const;
export type MessageOrigin = (typeof MESSAGE_ORIGINS)[number];

/** An attachment's metadata. Never the file, and never a URL to it. */
export type MessageMedia = {
  kind: "image" | "video" | "audio" | "document" | "sticker";
  id?: string;
  mime_type?: string;
  filename?: string;
  sha256?: string;
};

/** Evidence about a message. Every field is optional, and only ever added to. */
export type MessageEvidence = {
  origin?: MessageOrigin;
  failure_reason?: WaFailureReason | null;
  failure_code?: number | null;
  sent_at?: string;
  delivered_at?: string;
  read_at?: string;
  failed_at?: string;
  media?: MessageMedia;
};

/** What the provider's answer to a send adds to the record. */
export function evidenceOfSend(outcome: WaSendOutcome, at: string): MessageEvidence {
  if (outcome.state === "accepted") return { sent_at: at };
  if (outcome.state === "rejected") {
    return { failed_at: at, failure_reason: outcome.reason, failure_code: outcome.providerCode };
  }
  // No answer: there is no time it was sent at, and no failure to record.
  return {};
}

/** What a delivery receipt adds to the record. */
export function evidenceOfReceipt(
  incoming: WaProviderStatus,
  at: string,
  errorCode?: number | null,
): MessageEvidence {
  if (incoming === "sent") return { sent_at: at };
  if (incoming === "delivered") return { delivered_at: at };
  if (incoming === "read") return { read_at: at };
  return {
    failed_at: at,
    failure_reason: failureReasonForCode(errorCode),
    failure_code: errorCode ?? null,
  };
}

/**
 * The time on a receipt. Meta stamps it in unix seconds; that is what is
 * recorded, because a receipt can reach us long after the event. A value that
 * is missing, unreadable or nowhere near now is not put on record as a time:
 * the moment it arrived is used instead.
 */
export function receiptTime(raw: string | number | null | undefined, now = Date.now()): string {
  const ms = Number(raw) * 1000;
  const week = 7 * 24 * 60 * 60 * 1000;
  const believable = raw != null && raw !== "" && Number.isFinite(ms) && Math.abs(ms - now) < week;
  return new Date(believable ? ms : now).toISOString();
}

/** The attachment an inbound message carried, as metadata only. */
export function mediaOf(message: {
  image?: { id?: string; mime_type?: string; sha256?: string } | undefined;
  video?: { id?: string; mime_type?: string; sha256?: string } | undefined;
  audio?: { id?: string; mime_type?: string; sha256?: string } | undefined;
  document?: { id?: string; mime_type?: string; sha256?: string; filename?: string } | undefined;
  sticker?: { id?: string; mime_type?: string; sha256?: string } | undefined;
}): MessageMedia | null {
  for (const kind of ["image", "video", "audio", "document", "sticker"] as const) {
    const part = message[kind];
    if (!part) continue;
    const filename = kind === "document" ? message.document?.filename : undefined;
    return {
      kind,
      ...(part.id ? { id: part.id } : {}),
      ...(part.mime_type ? { mime_type: part.mime_type } : {}),
      ...(filename ? { filename: filename.slice(0, 255) } : {}),
      ...(part.sha256 ? { sha256: part.sha256 } : {}),
    };
  }
  return null;
}
