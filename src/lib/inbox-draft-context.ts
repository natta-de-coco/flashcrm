import { createContext, type Dispatch, type SetStateAction } from "react";
import type { Drafts } from "./inbox-drafts";
import type { InboxSendSession } from "./inbox-send-session";
export const InboxDraftContext = createContext<{
  state: Drafts;
  setState: Dispatch<SetStateAction<Drafts>>;
  sends: InboxSendSession;
} | null>(null);
