export type Drafts = { scope: string; values: Record<string, string> };
export const emptyDrafts = (scope: string): Drafts => ({ scope, values: {} });
export function changeDraft(state: Drafts, scope: string, id: string, value: string): Drafts {
  const current = state.scope === scope ? state : emptyDrafts(scope);
  const values = { ...current.values };
  if (value) values[id] = value;
  else delete values[id];
  return { scope, values };
}
/** A slow response may acknowledge its own draft only, never newer edits. */
export function acknowledgeReply(state: Drafts, scope: string, id: string, sent: string): Drafts {
  if (state.scope !== scope || (state.values[id] ?? "").trim() !== sent.trim()) return state;
  return changeDraft(state, scope, id, "");
}
export function insertSuggestion(
  state: Drafts,
  scope: string,
  id: string,
  before: string,
  suggestion: string,
): Drafts {
  if (state.scope !== scope || (state.values[id] ?? "") !== before) return state;
  return changeDraft(state, scope, id, suggestion);
}
