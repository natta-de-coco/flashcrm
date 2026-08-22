// Client-safe list of API key scopes (shared by the Settings UI and the server).
export const API_SCOPES = [
  "leads:read",
  "contacts:read",
  "conversations:read",
  "numbers:read",
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export const SCOPE_LABELS: Record<ApiScope, string> = {
  "leads:read": "Read leads",
  "contacts:read": "Read contacts",
  "conversations:read": "Read conversations",
  "numbers:read": "Read connected numbers",
};
