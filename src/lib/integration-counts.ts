// What the Integrations page counts as connected, and what still needs
// finishing. Pure, so the tiles and the banner can be tested without a browser.
//
// QA M1: the "Finish connecting — Choose Facebook / Choose Instagram" banner
// stayed up although both were connected. The OAuth callback keeps one
// unidentified row per platform (connections.server.ts:197-219, external_id
// null) and the account picker only deletes it once a Page is chosen
// (social-doctor.functions.ts). Start sign-in a second time and abandon the
// picker and that row lives on for ever, so the page kept asking for a choice
// that had already been made.
//
// QA M4: "Connected 2" ignored WhatsApp although its own panel said Connected.
// WhatsApp is not a social_accounts platform — it lives in wa_numbers
// (connections-catalog.ts EXTERNAL_CONNECTORS) — and the tile counted only
// social_accounts rows.

export type ConnectionRowLike = {
  id: string;
  platform: string;
  active: boolean;
  external_id: string | null;
  connect_method: string;
};

/** Connections that name the account they manage: the real, usable ones. */
export function identifiedAccounts<T extends ConnectionRowLike>(rows: ReadonlyArray<T>): T[] {
  return rows.filter((row) => row.active && Boolean(row.external_id));
}

/**
 * The sign-ins that still need an account chosen — and only those. A platform
 * that already has an identified connection is not asked about again: the
 * leftover row is debris from an extra sign-in, not work for the reader.
 */
export function pendingConnectionPrompts<T extends ConnectionRowLike>(rows: ReadonlyArray<T>): T[] {
  const finished = new Set(identifiedAccounts(rows).map((row) => row.platform));
  return rows.filter(
    (row) =>
      row.active &&
      !row.external_id &&
      row.connect_method === "oauth" &&
      !finished.has(row.platform),
  );
}

/**
 * Everything this workspace has connected, counted the way the cards below the
 * tile count it: social accounts plus each active WhatsApp number.
 */
export function connectedChannelCount(input: {
  accounts: ReadonlyArray<ConnectionRowLike>;
  whatsappNumbers: ReadonlyArray<{ active: boolean }>;
}): number {
  return (
    identifiedAccounts(input.accounts).length +
    input.whatsappNumbers.filter((number) => number.active).length
  );
}
