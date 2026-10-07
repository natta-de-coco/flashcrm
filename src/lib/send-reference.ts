// The reference a message is sent under.
//
// It belongs to what is being sent, not to the click. The same text to the
// same conversation keeps its reference until the server has answered for it,
// so a request whose answer never arrived is repeated under the same
// reference -- and the server, which saves a message under a reference once,
// can tell that repeat from a new message. Change the text, the conversation
// or the template and it is a different message with a different reference.

export type SendReference = { key: string; ref: string };

/** The reference for `key`: the one already held for it, or a new one. */
export function referenceFor(
  current: SendReference | null,
  key: string,
  newRef: () => string,
): SendReference {
  return current && current.key === key ? current : { key, ref: newRef() };
}
