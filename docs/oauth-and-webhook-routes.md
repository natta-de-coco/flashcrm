# Canonical routes and OAuth architecture

One documented route per integration, and what guards each one.

Written 2026-09-09 against the repository. Every path below was read from the
route files, not assumed from a naming convention.

---

## 1. OAuth

There is exactly **one** OAuth callback for every provider:

```
/api/public/oauth-callback
```

Register that path — on the deployment's own origin — in every provider app:
Meta, Google, LinkedIn, TikTok, X and Pinterest. The provider is identified by
the `state` row, not by the URL, so there is no per-provider callback to keep in
sync and no chance of one drifting.

`OAUTH_REDIRECT_PATH` in `src/lib/connection-setup.ts` is the single constant;
`oauth.server.ts` builds the redirect from it.

### What guards it

| Control | Where | Note |
|---|---|---|
| Cryptographic state | `startAuthorization()` | Two `crypto.randomUUID()` values, ~244 bits |
| **State stored hashed** | `20260909100000` | Only the SHA-256 is written. The value exists in the provider's redirect and nowhere we control |
| Single use | `consume_oauth_state_hash()` | One `UPDATE … WHERE used_at IS NULL`, so two concurrent callbacks cannot both win |
| Expiry | `oauth_states.expires_at` | 15 minutes, enforced in the same statement |
| Replay prevention | same | A second presentation matches no row |
| PKCE (S256) | `PKCE_PROVIDERS` | X, TikTok, Google. See the note below |
| Redirect allowlist | `resolveAllowedOrigin()` | Parsed-origin comparison, never a string prefix |
| Tenant binding | `oauth_states.tenant_id` | The workspace comes from the row, never from the request |
| User binding | `oauth_states.user_id` | Recorded and audited |
| Provider binding | `oauth_states.platform` | A code obtained for one platform cannot be redeemed for another |
| Redacted errors | `redactSecrets()` | Applied before logging, auditing, or returning to the browser |
| Outcome auditing | `oauth-callback.ts` | `succeeded`, `cancelled`, `expired`, `failed`, plus `abandoned` from the sweep |

### PKCE coverage

Enabled for **X, TikTok and Google**. TikTok requires it; X and Google support
S256 and accept it.

Meta's classic login dialog and Pinterest are deliberately excluded: an
unsupported `code_challenge` is an unknown parameter, and providers differ in
whether they ignore or reject those. Widen this list only against a source that
says the provider supports PKCE — not on the assumption that extra parameters
are harmless.

### Redirect allowlist configuration

`OAUTH_ALLOWED_ORIGINS` — comma-separated origins the provider may redirect
back to. Falls back to `PUBLIC_APP_URL`, then to loopback so development is not
blocked.

Comparison is on the parsed origin. `https://flas.example.com` does **not**
match `https://flas.example.com.attacker.test`, and a different port is a
different origin. Plain `http` is refused for anything except `localhost` and
`127.0.0.1`.

Providers enforce their own redirect allowlists too, which limits real-world
exposure — but the origin arrives from the browser, so it is attacker-influenced
input reaching an outbound URL, and it is checked here regardless.

---

## 2. Webhooks

| Integration | Canonical route | Verification |
|---|---|---|
| WhatsApp Cloud API | `/api/public/whatsapp/webhook` | `X-Hub-Signature-256` HMAC against the number's `app_secret`; **fails closed** when no secret is configured |
| Payments (Paddle) | `/api/public/payments/webhook` | Provider signature |
| WordPress plugin | `/api/public/webhooks/wordpress` | Per-site shared secret |
| Shopify | `/api/public/webhooks/shopify` | Per-site shared secret |
| Custom / script tag | `/api/public/webhooks/custom` | Per-site key with domain pinning |

### The naming inconsistency, and why it stays

Three webhooks live under `/api/public/webhooks/…` while WhatsApp and payments
sit at `/api/public/whatsapp/webhook` and `/api/public/payments/webhook`.

They are **not** being moved. Both are registered in an external system — the
WhatsApp URL is configured in every customer's Meta app, and the payments URL in
Paddle. Renaming them would silently stop inbound delivery for every existing
customer, and the benefit is tidiness. If they are ever unified, it must be by
adding the new path as an alias first, migrating each customer's configuration,
and only then retiring the old one.

Documenting the real routes is the fix. An undocumented inconsistency is a
hazard; a documented one is a decision.

---

## 3. Where secrets must never appear

Enforced by `redactSecrets()` at every boundary that leaves the server, and
covered by `tests/oauth-security.test.mjs`:

- client JSON and HTML
- URL query parameters after callback processing — the callback returns a
  sanitised code, never provider text
- console logs
- audit-log `details`
- `integration_errors.provider_message`

Patterns cover `access_token`, `refresh_token`, `client_secret`, `app_secret`,
`api_key`, `password`, bearer headers, bare Meta `EAA…` tokens, authorization
`code=` and `state=`.

Two of those were added because a test failed: the value character class
excluded `/`, so a Google refresh token — they begin `1//` — passed through
redaction intact.

---

## 4. Not yet done

**Tokens are stored in plaintext.** `social_accounts.access_token` and
`refresh_token` are not encrypted at rest. The pattern to follow already exists
in this codebase — `tenant_smtp_config.api_key_enc` uses `pgp_sym_encrypt` with
a key from Vault — but the change touches more than twenty read paths across
`social.server.ts`, `social-doctor.server.ts`, `wa.server.ts`,
`integration-health.server.ts`, `meta-discovery.server.ts` and
`flash-ai.server.ts`. It is all-or-nothing: any read site left on the plaintext
column stops working the moment writes switch to the encrypted one.

It is deliberately a separate change rather than a rushed part of this one.

**Key rotation** depends on that work and is not started.

---

## 5. Rollback

```sql
-- Reverting the code alone is not enough: new rows carry no plaintext state.
-- Restore the previous consumption path first, then redeploy.
DROP FUNCTION IF EXISTS public.consume_oauth_state_hash(text);
DROP FUNCTION IF EXISTS public.try_lock_connection_refresh(uuid);
DROP INDEX IF EXISTS oauth_states_state_hash_key;
ALTER TABLE public.oauth_states DROP COLUMN IF EXISTS state_hash;
-- `state` was made nullable; rows written while hashed have NULL there and
-- cannot be consumed by the old function. In-flight authorizations are lost.
-- They live fifteen minutes, so waiting that long before rolling back avoids
-- the issue entirely.
```
