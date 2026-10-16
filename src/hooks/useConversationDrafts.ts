import {
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type SetStateAction,
} from "react";
import { InboxDraftContext } from "@/lib/inbox-draft-context";
import { acknowledgeReply, changeDraft, emptyDrafts, insertSuggestion } from "@/lib/inbox-drafts";
import { InboxSendSession } from "@/lib/inbox-send-session";
/** Session-memory only: customer reply content is never written to browser storage. */
export function useConversationDrafts(scope: string, id: string | null) {
  const shared = useContext(InboxDraftContext);
  const [local, setLocal] = useState(() => emptyDrafts(scope));
  const [localSends] = useState(() => new InboxSendSession());
  const sends = shared?.sends ?? localSends;
  useSyncExternalStore(sends.subscribe, sends.snapshot, sends.snapshot);
  const state = shared?.state ?? local,
    setState = shared?.setState ?? setLocal;
  const latestScope = useRef(scope);
  latestScope.current = scope;
  useEffect(
    () => setState((current) => (current.scope === scope ? current : emptyDrafts(scope))),
    [scope, setState],
  );
  const draft = state.scope === scope && id ? (state.values[id] ?? "") : "";
  const setDraft = (value: SetStateAction<string>) => {
    if (!id || latestScope.current !== scope) return;
    setState((current) => {
      const previous = current.scope === scope ? (current.values[id] ?? "") : "";
      return changeDraft(current, scope, id, typeof value === "function" ? value(previous) : value);
    });
  };
  return {
    draft,
    sends,
    setDraft,
    hasDraft: (conversationId: string) => state.scope === scope && !!state.values[conversationId],
    append: (conversationId: string, body: string) =>
      setState((current) =>
        current.scope === scope
          ? changeDraft(
              current,
              scope,
              conversationId,
              current.values[conversationId]
                ? `${current.values[conversationId]}\n\n${body}`
                : body,
            )
          : current,
      ),
    acknowledge: (conversationId: string, sent: string) =>
      setState((current) => acknowledgeReply(current, scope, conversationId, sent)),
    suggest: (conversationId: string, before: string, suggestion: string) =>
      setState((current) => insertSuggestion(current, scope, conversationId, before, suggestion)),
  };
}
