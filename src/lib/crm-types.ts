export type LeadStage = "new" | "qualified" | "proposal" | "negotiation" | "won" | "lost";
export type ConvStatus = "open" | "pending" | "closed";
export type ConvChannel = "whatsapp" | "web";

export const STAGES: { id: LeadStage; label: string }[] = [
  { id: "new", label: "New" },
  { id: "qualified", label: "Qualified" },
  { id: "proposal", label: "Proposal" },
  { id: "negotiation", label: "Negotiation" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
];

export type Contact = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  company: string | null;
  tags: string[];
  stage: LeadStage;
  value: number;
  notes: string | null;
  owner_id: string | null;
  last_message_at: string | null;
  consent_given?: boolean;
  consent_at?: string | null;
  created_at: string;
};

export type Conversation = {
  id: string;
  contact_id: string;
  channel: ConvChannel;
  status: ConvStatus;
  assigned_to: string | null;
  bot_enabled: boolean;
  tags: string[];
  unread_count: number;
  last_message_at: string;
  last_message_preview: string | null;
  wa_number_id?: string | null;
  contacts?: Pick<Contact, "id" | "name" | "phone" | "company" | "stage"> | null;
  wa_numbers?: { label: string; display_phone: string | null } | null;
};

export type Message = {
  id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  sender: "contact" | "agent" | "bot";
  sender_id: string | null;
  body: string;
  status: string;
  created_at: string;
};
