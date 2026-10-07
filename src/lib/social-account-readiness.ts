// Whether a connected account on the Social screen can be synced, or is a
// sign-in that still has to be finished.
//
// PR #28 replaced Sync with "Finish connecting" for every account that has no
// `external_id`, because a Facebook or Instagram sign-in whose Page was never
// chosen has nothing to sync. But a missing id only means that for a sign-in
// that is waiting for its Page or account to be chosen:
//
//   - TikTok's sync finds the account from the access token and never uses the
//     id (syncTikTok in social.server.ts), and TikTok has no account to choose.
//     A TikTok account added with a token only is complete, and it lost its
//     Sync button.
//   - A connection that was pasted in is not a sign-in at all. Connect & setup
//     lists only sign-ins as waiting (pendingConnectionPrompts in
//     integration-counts.ts), so "Finish connecting" sent it to a page with
//     nothing to finish. Its Sync says which detail is missing.
//
// Pure functions with no imports: the logic is tested directly in
// tests/social-hub.test.mjs, against the real sync.

export type ConnectedAccountLike = {
  platform: string;
  external_id: string | null;
  /** "oauth" for a connection made by signing in; "manual" for a pasted one. */
  connect_method?: string | null;
};

/** Platforms whose sync finds the account from the access token alone. */
export const TOKEN_ONLY_SYNC_PLATFORMS: readonly string[] = ["tiktok"];

/**
 * True when this connection is a sign-in that still needs its Page or account
 * chosen — the only case where there is something to finish on Connect & setup
 * and nothing Sync could do.
 */
export function isUnfinishedConnection(account: ConnectedAccountLike): boolean {
  if (account.external_id) return false;
  if (TOKEN_ONLY_SYNC_PLATFORMS.includes(account.platform)) return false;
  return account.connect_method === "oauth";
}
