/**
 * Which replies belong to which incoming social message, and whether each
 * reply actually reached the customer.
 *
 * A reply used to be stored with nothing naming the message it answered, so
 * the inbox showed every reply sent from the same Page after a message arrived:
 * one customer's thread displayed another customer's answers. A reply now
 * carries a marker in external_id naming its message. That column is unique per
 * account, so the marker also carries the moment it was written, and it records
 * whether the platform accepted the reply -- the status column only allows
 * open/replied/archived, and a Messenger reply saved in FLAS was never sent.
 */
type ThreadRow = {
  id: string;
  account_id: string;
  kind: string;
  direction: string;
  external_id?: string | null;
  created_at: string;
  replied_at?: string | null;
};

const PREFIX = "reply:";

/** The external_id a reply is stored with. */
export function replyMarker(inboundId: string, delivered: boolean, at = Date.now()): string {
  return `${PREFIX}${inboundId}:${delivered ? "sent" : "saved"}:${at}`;
}

function parseMarker(
  externalId: string | null | undefined,
): { inboundId: string; delivered: boolean } | null {
  if (!externalId?.startsWith(PREFIX)) return null;
  const [inboundId, state] = externalId.slice(PREFIX.length).split(":");
  if (!inboundId || (state !== "sent" && state !== "saved")) return null;
  return { inboundId, delivered: state === "sent" };
}

/**
 * The incoming message a stored reply answers, or null when this row is not one
 * of our saved replies. A reply carries no thread_id and no customer name, so
 * this marker is the only thing that ties it to the conversation it belongs to.
 */
export function replyParentId(externalId: string | null | undefined): string | null {
  return parseMarker(externalId)?.inboundId ?? null;
}

/**
 * The replies to one incoming message, oldest first. A reply written before
 * the marker existed counts only if it was saved in the same moment the
 * message was marked replied -- the same action, never "anything later".
 */
export function repliesFor<T extends ThreadRow>(active: ThreadRow, all: readonly T[]): T[] {
  const repliedAt = active.replied_at ? Date.parse(active.replied_at) : Number.NaN;
  return all
    .filter((row) => row.direction === "out" && row.account_id === active.account_id)
    .filter((row) => {
      const marker = parseMarker(row.external_id);
      if (marker) return marker.inboundId === active.id;
      if (row.external_id) return false;
      if (Number.isNaN(repliedAt) || row.kind !== active.kind) return false;
      return Math.abs(Date.parse(row.created_at) - repliedAt) < 10_000;
    })
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

/**
 * Whether a stored reply reached the customer. Before markers, Messenger
 * replies were only ever saved in FLAS, never sent; a comment reply's fate was
 * not recorded, so it is unknown rather than guessed.
 */
export function replyDelivery(row: {
  kind: string;
  external_id?: string | null;
}): "sent" | "not_sent" | "unknown" {
  const marker = parseMarker(row.external_id);
  if (marker) return marker.delivered ? "sent" : "not_sent";
  return row.kind === "dm" ? "not_sent" : "unknown";
}
