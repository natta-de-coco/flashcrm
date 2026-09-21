/**
 * How long a customer has been waiting, in the words a person would use.
 *
 * The bot used to receive a conversation with no sense of time at all, so a
 * message sent five days ago read exactly like one sent a minute ago: it
 * answered "yes, we deliver" as if nothing had happened, with no apology and
 * no acknowledgement that the question might be stale.
 */
export function waitedFor(sentAt: string | null | undefined, now = Date.now()): string | null {
  if (!sentAt) return null;
  const at = Date.parse(sentAt);
  if (Number.isNaN(at)) return null;
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  return weeks < 9 ? `${weeks} weeks ago` : "over two months ago";
}

/** Whether a reply now is late enough that ignoring the delay would be rude. */
export function isLate(sentAt: string | null | undefined, now = Date.now()): boolean {
  if (!sentAt) return false;
  const at = Date.parse(sentAt);
  return !Number.isNaN(at) && now - at > 2 * 60 * 60 * 1000;
}

/** The catch-up line added to the bot's instructions when a reply is late. */
export function lateReplyRule(waited: string): string {
  return `The customer's last message arrived ${waited} and is still unanswered. Open by acknowledging the wait in one short, sincere clause -- no excuses, no blaming a system -- then answer what they actually asked. If what they asked may have changed since (stock, price, a date), answer with what you know and ask them to confirm it is still what they need.`;
}
