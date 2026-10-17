import { useEffect, useState, type ReactNode } from "react";
import { InboxDraftContext } from "@/lib/inbox-draft-context";
import { emptyDrafts } from "@/lib/inbox-drafts";
import { keepDrafts, recallDrafts } from "@/lib/inbox-draft-keeper";
import { InboxSendSession } from "@/lib/inbox-send-session";
/**
 * Mounted by identity below TenantProvider; drafts survive app navigation only.
 * The one other thing they survive is the two-factor code prompt, which takes
 * this tree off the screen without ending the session: what is kept for exactly
 * this person and company comes back with it (see lib/inbox-draft-keeper.ts).
 */
export function InboxDraftProvider({ scope, children }: { scope: string; children: ReactNode }) {
  const [recalled] = useState(() => recallDrafts(scope));
  const [state, setState] = useState(() => recalled?.state ?? emptyDrafts(scope));
  const [fresh] = useState(() => new InboxSendSession());
  const sends = recalled?.sends ?? fresh;
  useEffect(() => keepDrafts(scope, state, sends), [scope, state, sends]);
  return (
    <InboxDraftContext.Provider value={{ state, setState, sends }}>
      {children}
    </InboxDraftContext.Provider>
  );
}
