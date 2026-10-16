import { useState, type ReactNode } from "react";
import { InboxDraftContext } from "@/lib/inbox-draft-context";
import { emptyDrafts } from "@/lib/inbox-drafts";
import { InboxSendSession } from "@/lib/inbox-send-session";
/** Mounted by identity below TenantProvider; drafts survive app navigation only. */
export function InboxDraftProvider({ scope, children }: { scope: string; children: ReactNode }) {
  const [state, setState] = useState(() => emptyDrafts(scope));
  const [sends] = useState(() => new InboxSendSession());
  return (
    <InboxDraftContext.Provider value={{ state, setState, sends }}>
      {children}
    </InboxDraftContext.Provider>
  );
}
