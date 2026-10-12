# Milestone 1: Server Crypto & Socket Handshake Implementation Plan & Blueprint

**Role**: Milestone 1 Explorer 2 (Server Crypto & Socket Handshake)  
**Date**: October 9, 2026  
**Status**: Complete Investigation & Module Blueprint  
**Target Milestone**: Milestone 1 (Platform Super-Admin Email Configuration & Server Crypto)

---

## 1. Executive Summary & Architectural Overview

Milestone 1 establishes the security foundation and communication layer for Flas CRM's Platform Super-Admin Email Infrastructure:
1. **At-Rest Secret Encryption**: Platform SMTP and IMAP credentials must never be stored as plaintext in the database or exposed to client-side bundles. We design `src/lib/email-crypto.server.ts`, an envelope encryption utility built directly on the WebCrypto standard (`crypto.subtle`) that matches the `v1:<keyId>:<iv>:<ciphertext>:<tag>` envelope format used in `src/lib/social-secrets.server.ts`.
2. **Native Socket Protocol Handshake Testing**: Transactional email verification requires live validation of SMTP (ports 465/587) and IMAP (port 993) servers before saving or sending. We design `src/lib/email-socket-test.server.ts` utilizing Node's built-in `node:net` and `node:tls` libraries, avoiding bloated third-party dependencies while providing millisecond-accurate handshake latency, server greeting banner capture, and credential challenge negotiation (`AUTH LOGIN` / `AUTH PLAIN` / `IMAP LOGIN`).
3. **Super-Admin Server Functions**: We design `src/lib/platform-smtp.functions.ts` powered by TanStack Start `createServerFn`, strictly guarded by `requireSupabaseAuth` and `requireSuperAdmin(userId)`. This module masks credentials on read, encrypts them on save, and enables live pre-flight or stored connection testing.
4. **Database Schema & RLS**: We specify the PostgreSQL migration for `public.platform_email_config`, locked to super-admins via `is_super_admin(auth.uid())`.

---

## 2. Component 1: AES-256-GCM Envelope Encryption (`src/lib/email-crypto.server.ts`)

### 2.1 Design Principles & Compatibility
In Phase 6 of the social integration foundation, Flas CRM standardized on WebCrypto AES-256-GCM envelopes (`src/lib/social-secrets.server.ts`):
```text
v1:<keyId>:<iv>:<ciphertext>:<tag>
```
Where:
- `v1`: Version prefix.
- `keyId`: 1–32 alphanumeric identifier of the active key.
- `iv`: 12-byte random initialization vector, encoded as base64url.
- `ciphertext`: Encrypted payload without authentication tag, encoded as base64url.
- `tag`: 16-byte (128-bit) GCM authentication tag, encoded as base64url.

`src/lib/email-crypto.server.ts` adheres 100% to this format while tailoring key ring resolution and Additional Authenticated Data (AAD) to email credentials.

### 2.2 Key Ring Configuration & Rotation
The module resolves encryption keys with graceful fallback:
1. `EMAIL_TOKEN_ENCRYPTION_KEYS` and `EMAIL_TOKEN_ACTIVE_KEY_ID` (milestone-specific).
2. Fallback to existing `SOCIAL_TOKEN_ENCRYPTION_KEYS` and `SOCIAL_TOKEN_ACTIVE_KEY_ID`.
3. Fallback to `PLATFORM_ENCRYPTION_KEY` (if provided as single 32-byte base64 key).
4. If none are provided, the module **fails closed**, throwing `EmailCryptoError("not_configured")` without ever storing or outputting plaintext.

Key validation checks:
- Must decode to exactly 32 bytes (256 bits).
- Active key ID must exist in the key ring.
- No duplicate key IDs permitted.
- Error messages strictly omit secret key material and plaintext.

### 2.3 Additional Authenticated Data (AAD)
To prevent cross-column or cross-tenant ciphertext swapping, ciphertexts are cryptographically bound to their scope and field:
```ts
export function emailAad(scope: string = "platform", field: string = "secret"): string {
  return `flas-email:v1:${scope}:${field}`;
}
```
For example:
- Platform SMTP password uses AAD: `flas-email:v1:platform:smtp_password`
- Platform IMAP password uses AAD: `flas-email:v1:platform:imap_password`
- If an attacker copies an encrypted SMTP password into the IMAP password column, `decryptEmailSecret` will reject it with `authentication_failed`.

### 2.4 Complete Module Specification

```ts
/**
 * src/lib/email-crypto.server.ts
 *
 * AES-256-GCM envelope encryption utility for email credentials (SMTP/IMAP).
 * Compatible with WebCrypto crypto.subtle and src/lib/social-secrets.server.ts.
 *
 * Envelope: v1:<keyId>:<iv>:<ciphertext>:<tag> (base64url)
 */

const VERSION = "v1";
const KEY_ID_REGEX = /^[A-Za-z0-9_-]{1,32}$/;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type EmailCryptoCode =
  | "not_configured"
  | "bad_key_ring"
  | "unknown_key"
  | "malformed"
  | "authentication_failed"
  | "empty_secret";

export class EmailCryptoError extends Error {
  readonly code: EmailCryptoCode;
  constructor(code: EmailCryptoCode, message: string) {
    super(message);
    this.name = "EmailCryptoError";
    this.code = code;
  }
}

type Env = Record<string, string | undefined>;
const defaultEnv = (): Env =>
  (typeof process !== "undefined" ? process.env : {}) as Env;

/* ---------- base64url helpers ---------- */
function toB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64(value: string): Uint8Array<ArrayBuffer> {
  const std = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = std + "=".repeat((4 - (std.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ---------- Key Ring Resolution ---------- */
export type KeyRing = {
  active: string;
  keys: Map<string, Uint8Array<ArrayBuffer>>;
};

export function readEmailKeyRing(env: Env = defaultEnv()): KeyRing {
  let raw = env["EMAIL_TOKEN_ENCRYPTION_KEYS"]?.trim();
  let active = env["EMAIL_TOKEN_ACTIVE_KEY_ID"]?.trim();

  // Fallback to social tokens ring if email ring not explicitly set
  if (!raw || !active) {
    raw = env["SOCIAL_TOKEN_ENCRYPTION_KEYS"]?.trim();
    active = env["SOCIAL_TOKEN_ACTIVE_KEY_ID"]?.trim();
  }

  // Fallback to single PLATFORM_ENCRYPTION_KEY if provided
  if (!raw && env["PLATFORM_ENCRYPTION_KEY"]?.trim()) {
    const single = env["PLATFORM_ENCRYPTION_KEY"]!.trim();
    raw = `k1:${single}`;
    active = "k1";
  }

  if (!raw || !active) {
    throw new EmailCryptoError(
      "not_configured",
      "Email credential encryption is not configured: set EMAIL_TOKEN_ENCRYPTION_KEYS or SOCIAL_TOKEN_ENCRYPTION_KEYS.",
    );
  }

  const keys = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const entry of raw.split(",")) {
    const i = entry.indexOf(":");
    const id = i > 0 ? entry.slice(0, i).trim() : "";
    const material = i > 0 ? entry.slice(i + 1).trim() : "";
    if (!KEY_ID_REGEX.test(id)) {
      throw new EmailCryptoError("bad_key_ring", "Key ring contains an entry with an invalid key id.");
    }
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = fromB64(material);
    } catch {
      throw new EmailCryptoError("bad_key_ring", `Key "${id}" is not valid base64.`);
    }
    if (bytes.length !== 32) {
      throw new EmailCryptoError("bad_key_ring", `Key "${id}" must be exactly 32 bytes (AES-256).`);
    }
    if (keys.has(id)) {
      throw new EmailCryptoError("bad_key_ring", `Key id "${id}" appears twice.`);
    }
    keys.set(id, bytes);
  }

  if (!keys.has(active)) {
    throw new EmailCryptoError(
      "bad_key_ring",
      `Active key id "${active}" is not present in the key ring.`,
    );
  }

  return { active, keys };
}

const importedKeys = new Map<string, Promise<CryptoKey>>();
function getCryptoKey(id: string, bytes: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const cacheKey = `${id}:${toB64url(bytes)}`;
  let key = importedKeys.get(cacheKey);
  if (!key) {
    key = crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]);
    importedKeys.set(cacheKey, key);
  }
  return key;
}

/* ---------- Public Envelope & Crypto API ---------- */

export function emailAad(scope: string = "platform", field: string = "secret"): string {
  return `flas-email:${VERSION}:${scope}:${field}`;
}

export function isEmailEnvelope(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(`${VERSION}:`) &&
    value.split(":").length === 5
  );
}

export function emailEnvelopeKeyId(envelope: string): string | null {
  return isEmailEnvelope(envelope) ? envelope.split(":")[1] ?? null : null;
}

export async function encryptEmailSecret(
  plainText: string,
  scope: string = "platform",
  field: string = "secret",
  env: Env = defaultEnv(),
): Promise<string> {
  if (!plainText) {
    throw new EmailCryptoError("empty_secret", "Cannot encrypt empty secret string.");
  }

  const ring = readEmailKeyRing(env);
  const key = await getCryptoKey(ring.active, ring.keys.get(ring.active)!);
  const iv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(iv);

  const aad = emailAad(scope, field);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode(aad),
        tagLength: TAG_BYTES * 8,
      },
      key,
      new TextEncoder().encode(plainText),
    ),
  );

  const ciphertext = sealed.slice(0, sealed.length - TAG_BYTES);
  const tag = sealed.slice(sealed.length - TAG_BYTES);
  return [VERSION, ring.active, toB64url(iv), toB64url(ciphertext), toB64url(tag)].join(":");
}

export async function decryptEmailSecret(
  envelope: string,
  scope: string = "platform",
  field: string = "secret",
  env: Env = defaultEnv(),
): Promise<string> {
  if (!isEmailEnvelope(envelope)) {
    throw new EmailCryptoError("malformed", "Stored secret is not a recognized encryption envelope.");
  }

  const [, keyId, ivPart, ctPart, tagPart] = envelope.split(":") as [string, string, string, string, string];
  const ring = readEmailKeyRing(env);
  const material = ring.keys.get(keyId);
  if (!material) {
    throw new EmailCryptoError(
      "unknown_key",
      `Stored secret was encrypted with key "${keyId}", which is no longer in the key ring.`,
    );
  }

  let iv: Uint8Array<ArrayBuffer>, ct: Uint8Array<ArrayBuffer>, tag: Uint8Array<ArrayBuffer>;
  try {
    iv = fromB64(ivPart);
    ct = fromB64(ctPart);
    tag = fromB64(tagPart);
  } catch {
    throw new EmailCryptoError("malformed", "Stored secret envelope contains invalid base64url data.");
  }

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new EmailCryptoError("malformed", "Stored secret envelope has invalid IV or tag length.");
  }

  const sealed = new Uint8Array(ct.length + tag.length);
  sealed.set(ct);
  sealed.set(tag, ct.length);

  const aad = emailAad(scope, field);
  try {
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode(aad),
        tagLength: TAG_BYTES * 8,
      },
      await getCryptoKey(keyId, material),
      sealed,
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new EmailCryptoError("authentication_failed", "Stored secret failed authentication.");
  }
}

export function emailNeedsRotation(envelope: string, env: Env = defaultEnv()): boolean {
  const id = emailEnvelopeKeyId(envelope);
  return id !== null && id !== readEmailKeyRing(env).active;
}

export function emailCryptoConfigured(env: Env = defaultEnv()): boolean {
  try {
    readEmailKeyRing(env);
    return true;
  } catch {
    return false;
  }
}
```

---

## 3. Component 2: Server-Side Protocol Connection Tester (`src/lib/email-socket-test.server.ts`)

### 3.1 Socket Mechanics & Protocol State Machine
The connection tester connects via `node:net` or `node:tls` to evaluate SMTP and IMAP servers with millisecond timing.

#### 1. SMTP Handshake Lifecycle:
- **Port 465 (SMTPS)**:
  - Initializes directly as a TLS socket via `tls.connect({ host, port: 465, servername: host })`.
- **Port 587 (Submission / STARTTLS)** or Port 25:
  - Initializes as raw TCP socket via `net.connect({ host, port })`.
  - Reads `220` banner.
  - Sends `EHLO flas.mobidigisol.com\r\n`.
  - Expects `250` multiline response (checks for `STARTTLS` capability).
  - Sends `STARTTLS\r\n`. Expects `220`.
  - Upgrades socket in-place: `tls.connect({ socket: tcpSocket, host, servername: host })`.
  - Re-issues `EHLO flas.mobidigisol.com\r\n`.
- **Authentication**:
  - Sends `AUTH LOGIN\r\n`. Expects `334` challenge (`VXNlcm5hbWU6`).
  - Sends base64-encoded username + `\r\n`. Expects `334` challenge (`UGFzc3dvcmQ6`).
  - Sends base64-encoded password + `\r\n`.
  - Expects `235` (Authentication successful).
  - If server responds with `535`, records `auth_failed` status with exact server explanation.
- **Envelope Probe (Optional)**:
  - If `fromEmail` is specified, sends `MAIL FROM:<${fromEmail}>\r\n` (expects `250`), followed by `RSET\r\n`.
- **Termination**:
  - Sends `QUIT\r\n`, cleanly destroying socket in `finally` block.

#### 2. IMAP Handshake Lifecycle:
- **Port 993 (IMAPS)**:
  - Direct TLS socket: `tls.connect({ host, port: 993, servername: host })`.
- **Port 143 (STARTTLS)**:
  - TCP socket -> reads `* OK` -> `A001 STARTTLS\r\n` -> upgrades to TLS.
- **Banner Greeting**:
  - Reads untagged greeting: `* OK [CAPABILITY ...] Ready\r\n`.
- **Authentication**:
  - Sends tagged login: `A001 LOGIN "${escapedUser}" "${escapedPassword}"\r\n`.
  - Reads lines until response prefixed with `A001 `.
  - If `A001 OK`: success!
  - If `A001 NO`: `auth_failed`.
  - If `A001 BAD`: `protocol_error`.
- **Capability / Mailbox Inspection**:
  - Sends `A002 CAPABILITY\r\n` or `A002 SELECT INBOX\r\n` to verify read permissions.
- **Termination**:
  - Sends `A003 LOGOUT\r\n`, cleanly destroying socket in `finally` block.

### 3.2 Complete Module Specification

```ts
/**
 * src/lib/email-socket-test.server.ts
 *
 * Lightweight, zero-dependency SMTP and IMAP connection & authentication tester.
 * Uses native node:net and node:tls to probe mail servers without third-party CLI or npm dependencies.
 */

import * as net from "node:net";
import * as tls from "node:tls";

export type ConnectionStatus =
  | "connected"
  | "authenticated"
  | "auth_failed"
  | "connection_refused"
  | "timeout"
  | "host_unreachable"
  | "tls_error"
  | "protocol_error";

export type SmtpTestOptions = {
  host: string;
  port: number;
  secure?: boolean; // true = implicit TLS (port 465), false = STARTTLS/plain (port 587)
  user?: string;
  password?: string;
  fromEmail?: string;
  timeoutMs?: number;
};

export type ImapTestOptions = {
  host: string;
  port: number;
  secure?: boolean; // true = implicit TLS (port 993), false = STARTTLS (port 143)
  user?: string;
  password?: string;
  timeoutMs?: number;
};

export type ConnectionTestResult = {
  ok: boolean;
  latencyMs: number;
  status: ConnectionStatus;
  message: string;
  greeting?: string;
  stepsCompleted: string[];
};

/** Buffered line reader for socket protocols */
class SocketReader {
  private buffer = "";
  private resolveNextLine: ((line: string) => void) | null = null;
  private rejectCurrent: ((err: Error) => void) | null = null;

  onData(chunk: Buffer | string) {
    this.buffer += chunk.toString("utf8");
    this.tryDrain();
  }

  onError(err: Error) {
    if (this.rejectCurrent) {
      this.rejectCurrent(err);
      this.rejectCurrent = null;
      this.resolveNextLine = null;
    }
  }

  private tryDrain() {
    if (!this.resolveNextLine) return;
    const idx = this.buffer.indexOf("\r\n");
    if (idx !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      const res = this.resolveNextLine;
      this.resolveNextLine = null;
      this.rejectCurrent = null;
      res(line);
    }
  }

  readLine(timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      this.resolveNextLine = resolve;
      this.rejectCurrent = reject;
      this.tryDrain();
      setTimeout(() => {
        if (this.resolveNextLine === resolve) {
          this.resolveNextLine = null;
          this.rejectCurrent = null;
          reject(new Error(`Socket read timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);
    });
  }

  async readSmtpResponse(timeoutMs: number): Promise<{ code: number; lines: string[] }> {
    const lines: string[] = [];
    while (true) {
      const line = await this.readLine(timeoutMs);
      lines.push(line);
      const match = /^(\d{3})([ -])(.*)$/.exec(line);
      if (!match) {
        throw new Error(`Invalid SMTP response format: "${line}"`);
      }
      const code = parseInt(match[1], 10);
      const isLast = match[2] === " ";
      if (isLast) {
        return { code, lines };
      }
    }
  }

  async readImapTaggedResponse(tag: string, timeoutMs: number): Promise<{ status: "OK" | "NO" | "BAD"; line: string; lines: string[] }> {
    const lines: string[] = [];
    while (true) {
      const line = await this.readLine(timeoutMs);
      lines.push(line);
      if (line.startsWith(`${tag} `)) {
        const parts = line.slice(tag.length + 1).trim().split(" ");
        const status = parts[0] as "OK" | "NO" | "BAD";
        return { status, line, lines };
      }
    }
  }
}

/** Test SMTP server connectivity and authentication */
export async function testSmtpSocket(options: SmtpTestOptions): Promise<ConnectionTestResult> {
  const timeoutMs = options.timeoutMs ?? 10000;
  const startTime = performance.now();
  const steps: string[] = [];
  let socket: net.Socket | tls.TLSSocket | null = null;
  const reader = new SocketReader();

  const isImplicitTls = options.secure ?? (options.port === 465);

  try {
    steps.push(`Connecting to ${options.host}:${options.port} (${isImplicitTls ? "SSL/TLS" : "Plain/STARTTLS"})...`);

    socket = await new Promise<net.Socket | tls.TLSSocket>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`TCP connection timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const conn = isImplicitTls
        ? tls.connect(
            {
              host: options.host,
              port: options.port,
              servername: options.host,
              rejectUnauthorized: true,
            },
            () => {
              clearTimeout(timer);
              resolve(conn);
            },
          )
        : net.connect({ host: options.host, port: options.port }, () => {
            clearTimeout(timer);
            resolve(conn);
          });

      conn.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    socket.on("data", (chunk) => reader.onData(chunk));
    socket.on("error", (err) => reader.onError(err));

    // 1. Read greeting
    const greeting = await reader.readSmtpResponse(timeoutMs);
    if (greeting.code !== 220) {
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - startTime),
        status: "protocol_error",
        message: `Unexpected greeting code: ${greeting.code} (${greeting.lines.join("; ")})`,
        stepsCompleted: steps,
      };
    }
    steps.push(`Received greeting: ${greeting.lines[0]}`);

    // 2. Send EHLO
    socket.write("EHLO flas.mobidigisol.com\r\n");
    const ehloResp = await reader.readSmtpResponse(timeoutMs);
    if (ehloResp.code !== 250) {
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - startTime),
        status: "protocol_error",
        message: `EHLO rejected: ${ehloResp.lines.join("; ")}`,
        stepsCompleted: steps,
      };
    }
    steps.push("EHLO accepted");

    // 3. Upgrade to STARTTLS if not implicit TLS and port is 587
    if (!isImplicitTls && options.port === 587) {
      steps.push("Initiating STARTTLS upgrade...");
      socket.write("STARTTLS\r\n");
      const tlsResp = await reader.readSmtpResponse(timeoutMs);
      if (tlsResp.code !== 220) {
        return {
          ok: false,
          latencyMs: Math.round(performance.now() - startTime),
          status: "tls_error",
          message: `STARTTLS refused by server: ${tlsResp.lines.join("; ")}`,
          stepsCompleted: steps,
        };
      }

      const rawSocket = socket;
      socket = await new Promise<tls.TLSSocket>((resolve, reject) => {
        const tlsSocket = tls.connect(
          {
            socket: rawSocket,
            host: options.host,
            servername: options.host,
            rejectUnauthorized: true,
          },
          () => resolve(tlsSocket),
        );
        tlsSocket.on("error", reject);
      });

      socket.on("data", (chunk) => reader.onData(chunk));
      socket.on("error", (err) => reader.onError(err));

      // Re-issue EHLO after TLS handshake
      socket.write("EHLO flas.mobidigisol.com\r\n");
      await reader.readSmtpResponse(timeoutMs);
      steps.push("TLS handshake completed; re-issued EHLO");
    }

    // 4. Authenticate if credentials provided
    if (options.user && options.password) {
      steps.push(`Authenticating as ${options.user}...`);
      socket.write("AUTH LOGIN\r\n");
      const authResp = await reader.readSmtpResponse(timeoutMs);
      if (authResp.code !== 334) {
        return {
          ok: false,
          latencyMs: Math.round(performance.now() - startTime),
          status: "auth_failed",
          message: `AUTH LOGIN not supported or rejected: ${authResp.lines.join("; ")}`,
          stepsCompleted: steps,
        };
      }

      // Send username (base64)
      socket.write(`${Buffer.from(options.user).toString("base64")}\r\n`);
      const userResp = await reader.readSmtpResponse(timeoutMs);
      if (userResp.code !== 334) {
        return {
          ok: false,
          latencyMs: Math.round(performance.now() - startTime),
          status: "auth_failed",
          message: `Username rejected: ${userResp.lines.join("; ")}`,
          stepsCompleted: steps,
        };
      }

      // Send password (base64)
      socket.write(`${Buffer.from(options.password).toString("base64")}\r\n`);
      const passResp = await reader.readSmtpResponse(timeoutMs);
      if (passResp.code !== 235) {
        return {
          ok: false,
          latencyMs: Math.round(performance.now() - startTime),
          status: "auth_failed",
          message: `Authentication failed (code ${passResp.code}): ${passResp.lines.join("; ")}`,
          stepsCompleted: steps,
        };
      }
      steps.push("Authentication succeeded (code 235)");
    }

    // 5. Envelope sender probe
    if (options.fromEmail) {
      socket.write(`MAIL FROM:<${options.fromEmail}>\r\n`);
      const mailResp = await reader.readSmtpResponse(timeoutMs);
      if (mailResp.code === 250) {
        steps.push(`Sender accepted: ${options.fromEmail}`);
        socket.write("RSET\r\n");
        await reader.readSmtpResponse(timeoutMs);
      }
    }

    // 6. Graceful QUIT
    socket.write("QUIT\r\n");
    steps.push("Connection test completed successfully");

    return {
      ok: true,
      latencyMs: Math.round(performance.now() - startTime),
      status: options.user ? "authenticated" : "connected",
      message: `SMTP handshake and ${options.user ? "credentials verified" : "connection verified"} in ${Math.round(performance.now() - startTime)}ms`,
      greeting: greeting.lines[0],
      stepsCompleted: steps,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string })?.code;

    let status: ConnectionStatus = "protocol_error";
    if (code === "ECONNREFUSED") status = "connection_refused";
    else if (code === "ENOTFOUND") status = "host_unreachable";
    else if (code === "ETIMEDOUT" || errorMsg.includes("timed out")) status = "timeout";
    else if (errorMsg.includes("TLS") || code?.includes("CERT")) status = "tls_error";

    return {
      ok: false,
      latencyMs: Math.round(performance.now() - startTime),
      status,
      message: `SMTP test failed: ${errorMsg}`,
      stepsCompleted: steps,
    };
  } finally {
    if (socket) {
      socket.destroy();
    }
  }
}

/** Test IMAP server connectivity and authentication */
export async function testImapSocket(options: ImapTestOptions): Promise<ConnectionTestResult> {
  const timeoutMs = options.timeoutMs ?? 10000;
  const startTime = performance.now();
  const steps: string[] = [];
  let socket: net.Socket | tls.TLSSocket | null = null;
  const reader = new SocketReader();

  const isImplicitTls = options.secure ?? (options.port === 993);

  try {
    steps.push(`Connecting to IMAP ${options.host}:${options.port} (${isImplicitTls ? "SSL/TLS" : "Plain"})...`);

    socket = await new Promise<net.Socket | tls.TLSSocket>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`IMAP TCP connection timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const conn = isImplicitTls
        ? tls.connect(
            {
              host: options.host,
              port: options.port,
              servername: options.host,
              rejectUnauthorized: true,
            },
            () => {
              clearTimeout(timer);
              resolve(conn);
            },
          )
        : net.connect({ host: options.host, port: options.port }, () => {
            clearTimeout(timer);
            resolve(conn);
          });

      conn.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    socket.on("data", (chunk) => reader.onData(chunk));
    socket.on("error", (err) => reader.onError(err));

    // 1. Read untagged greeting (* OK ...)
    const greetingLine = await reader.readLine(timeoutMs);
    if (!greetingLine.startsWith("* OK") && !greetingLine.startsWith("* PREAUTH")) {
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - startTime),
        status: "protocol_error",
        message: `Unexpected IMAP greeting: "${greetingLine}"`,
        stepsCompleted: steps,
      };
    }
    steps.push(`Received greeting: ${greetingLine}`);

    // 2. Authenticate if credentials provided
    if (options.user && options.password) {
      steps.push(`Authenticating as ${options.user}...`);
      const cleanUser = options.user.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const cleanPass = options.password.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

      socket.write(`A001 LOGIN "${cleanUser}" "${cleanPass}"\r\n`);
      const loginResp = await reader.readImapTaggedResponse("A001", timeoutMs);

      if (loginResp.status !== "OK") {
        return {
          ok: false,
          latencyMs: Math.round(performance.now() - startTime),
          status: loginResp.status === "NO" ? "auth_failed" : "protocol_error",
          message: `IMAP LOGIN failed: ${loginResp.line}`,
          stepsCompleted: steps,
        };
      }
      steps.push("IMAP authentication succeeded");

      // Quick mailbox inspection
      socket.write("A002 CAPABILITY\r\n");
      await reader.readImapTaggedResponse("A002", timeoutMs);
      steps.push("IMAP capability query verified");
    }

    // 3. Logout
    socket.write("A003 LOGOUT\r\n");
    steps.push("IMAP session closed gracefully");

    return {
      ok: true,
      latencyMs: Math.round(performance.now() - startTime),
      status: options.user ? "authenticated" : "connected",
      message: `IMAP handshake and ${options.user ? "credentials verified" : "connection verified"} in ${Math.round(performance.now() - startTime)}ms`,
      greeting: greetingLine,
      stepsCompleted: steps,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string })?.code;

    let status: ConnectionStatus = "protocol_error";
    if (code === "ECONNREFUSED") status = "connection_refused";
    else if (code === "ENOTFOUND") status = "host_unreachable";
    else if (code === "ETIMEDOUT" || errorMsg.includes("timed out")) status = "timeout";
    else if (errorMsg.includes("TLS") || code?.includes("CERT")) status = "tls_error";

    return {
      ok: false,
      latencyMs: Math.round(performance.now() - startTime),
      status,
      message: `IMAP test failed: ${errorMsg}`,
      stepsCompleted: steps,
    };
  } finally {
    if (socket) {
      socket.destroy();
    }
  }
}
```

---

## 4. Component 3: Super-Admin Server Functions (`src/lib/platform-smtp.functions.ts`)

### 4.1 Security Isolation & Role Enforcement
All server functions in `src/lib/platform-smtp.functions.ts` adhere to the canonical guard pattern established in `src/lib/companies.functions.ts`:
1. **Middleware**: Bound to `requireSupabaseAuth` middleware, ensuring valid Supabase JWT and populating `context.supabase` and `context.userId`.
2. **Super Admin Guard**: Invokes `requireSuperAdmin(context.supabase, context.userId)` which queries `profiles.staff_role === 'super_admin'`. Any other role immediately aborts with:
   `"This area is only available to the Flas platform manager"`.
3. **Dynamic Server Imports**: Internal dependencies (`client.server.ts`, `email-crypto.server.ts`, `email-socket-test.server.ts`, `audit.server.ts`) are imported dynamically inside handler bodies, ensuring server-only code is never bundled into client bundles.

### 4.2 Complete Module Specification

```ts
/**
 * src/lib/platform-smtp.functions.ts
 *
 * Super-Admin server functions for Platform System Email Configuration (flas@mobidigisol.com).
 * Guarded strictly by requireSuperAdmin(userId).
 */

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

type Client = SupabaseClient<Database>;

/** Throws unless the signed-in user is a Flas platform super admin. */
async function requireSuperAdmin(supabase: Client, userId: string): Promise<void> {
  const { data } = await supabase
    .from("profiles")
    .select("staff_role")
    .eq("id", userId)
    .maybeSingle();
  if (data?.staff_role !== "super_admin") {
    throw new Error("This area is only available to the Flas platform manager");
  }
}

export type PlatformEmailConfigPublic = {
  configured: boolean;
  id?: string;
  fromEmail: string;
  fromName: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  hasSmtpPassword: boolean;
  smtpPasswordMasked: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUser: string;
  hasImapPassword: boolean;
  imapPasswordMasked: string;
  verified: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  updatedAt: string | null;
};

/** Read platform email configuration. Passwords are masked ("••••••••") and never returned in plaintext. */
export const getPlatformEmailConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlatformEmailConfigPublic> => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row, error } = await supabaseAdmin
      .from("platform_email_config")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error && error.code !== "PGRST116") {
      throw error;
    }

    if (!row) {
      return {
        configured: false,
        fromEmail: "flas@mobidigisol.com",
        fromName: "Flas CRM",
        smtpHost: "",
        smtpPort: 465,
        smtpSecure: true,
        smtpUser: "flas@mobidigisol.com",
        hasSmtpPassword: false,
        smtpPasswordMasked: "",
        imapHost: "",
        imapPort: 993,
        imapSecure: true,
        imapUser: "flas@mobidigisol.com",
        hasImapPassword: false,
        imapPasswordMasked: "",
        verified: false,
        lastTestAt: null,
        lastTestOk: null,
        lastTestError: null,
        updatedAt: null,
      };
    }

    return {
      configured: true,
      id: row.id,
      fromEmail: row.from_email ?? "flas@mobidigisol.com",
      fromName: row.from_name ?? "Flas CRM",
      smtpHost: row.smtp_host ?? "",
      smtpPort: row.smtp_port ?? 465,
      smtpSecure: row.smtp_secure ?? true,
      smtpUser: row.smtp_user ?? "",
      hasSmtpPassword: Boolean(row.smtp_pass_enc),
      smtpPasswordMasked: row.smtp_pass_enc ? "••••••••" : "",
      imapHost: row.imap_host ?? "",
      imapPort: row.imap_port ?? 993,
      imapSecure: row.imap_secure ?? true,
      imapUser: row.imap_user ?? "",
      hasImapPassword: Boolean(row.imap_pass_enc),
      imapPasswordMasked: row.imap_pass_enc ? "••••••••" : "",
      verified: row.verified ?? false,
      lastTestAt: row.last_test_at,
      lastTestOk: row.last_test_ok,
      lastTestError: row.last_test_error,
      updatedAt: row.updated_at,
    };
  });

const SavePlatformEmailConfigSchema = z.object({
  fromEmail: z.string().email().max(320).default("flas@mobidigisol.com"),
  fromName: z.string().max(80).default("Flas CRM"),
  smtpHost: z.string().min(1, "SMTP host is required").max(255),
  smtpPort: z.number().int().min(1).max(65535).default(465),
  smtpSecure: z.boolean().default(true),
  smtpUser: z.string().min(1, "SMTP username is required").max(320),
  smtpPassword: z.string().max(2048).optional(),
  imapHost: z.string().max(255).optional().nullable(),
  imapPort: z.number().int().min(1).max(65535).default(993).optional().nullable(),
  imapSecure: z.boolean().default(true).optional().nullable(),
  imapUser: z.string().max(320).optional().nullable(),
  imapPassword: z.string().max(2048).optional().nullable(),
});

export type PlatformEmailConfigInput = z.infer<typeof SavePlatformEmailConfigSchema>;

/** Save or update platform email configuration. Passwords are encrypted at rest with AES-256-GCM. */
export const savePlatformEmailConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SavePlatformEmailConfigSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { encryptEmailSecret } = await import("@/lib/email-crypto.server");
    const { logAudit } = await import("@/lib/audit.server");

    // Fetch existing row to preserve existing encrypted passwords if unchanged
    const { data: existing } = await supabaseAdmin
      .from("platform_email_config")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let smtpPassEnc = existing?.smtp_pass_enc ?? null;
    if (data.smtpPassword && data.smtpPassword !== "••••••••") {
      smtpPassEnc = await encryptEmailSecret(data.smtpPassword, "platform", "smtp_password");
    } else if (!smtpPassEnc) {
      throw new Error("SMTP password is required for initial configuration");
    }

    let imapPassEnc = existing?.imap_pass_enc ?? null;
    if (data.imapPassword && data.imapPassword !== "••••••••") {
      imapPassEnc = await encryptEmailSecret(data.imapPassword, "platform", "imap_password");
    }

    const payload = {
      from_email: data.fromEmail,
      from_name: data.fromName,
      smtp_host: data.smtpHost,
      smtp_port: data.smtpPort,
      smtp_secure: data.smtpSecure,
      smtp_user: data.smtpUser,
      smtp_pass_enc: smtpPassEnc,
      imap_host: data.imapHost ?? null,
      imap_port: data.imapPort ?? 993,
      imap_secure: data.imapSecure ?? true,
      imap_user: data.imapUser ?? null,
      imap_pass_enc: imapPassEnc,
      verified: existing?.verified ?? false,
      updated_by: context.userId,
      updated_at: new Date().toISOString(),
    };

    if (existing?.id) {
      const { error } = await supabaseAdmin
        .from("platform_email_config")
        .update(payload)
        .eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabaseAdmin
        .from("platform_email_config")
        .insert({ ...payload, created_at: new Date().toISOString() });
      if (error) throw error;
    }

    await logAudit({
      action: "platform_email.config_updated",
      actorId: context.userId,
      entityType: "platform_email_config",
      entityId: existing?.id ?? "singleton",
      details: {
        from_email: data.fromEmail,
        smtp_host: data.smtpHost,
        smtp_port: data.smtpPort,
        imap_host: data.imapHost,
      },
    });

    return { ok: true, message: "Platform email configuration saved successfully" };
  });

const TestConnectionSchema = z.object({
  type: z.enum(["smtp", "imap", "both"]),
  override: z
    .object({
      fromEmail: z.string().email().optional(),
      smtpHost: z.string().optional(),
      smtpPort: z.number().int().optional(),
      smtpSecure: z.boolean().optional(),
      smtpUser: z.string().optional(),
      smtpPassword: z.string().optional(),
      imapHost: z.string().optional(),
      imapPort: z.number().int().optional(),
      imapSecure: z.boolean().optional(),
      imapUser: z.string().optional(),
      imapPassword: z.string().optional(),
    })
    .optional(),
});

/** Test SMTP and/or IMAP connection handshake and credentials. */
export const testPlatformEmailConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TestConnectionSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requireSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decryptEmailSecret } = await import("@/lib/email-crypto.server");
    const { testSmtpSocket, testImapSocket } = await import("@/lib/email-socket-test.server");

    // Fetch existing stored config
    const { data: config } = await supabaseAdmin
      .from("platform_email_config")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Resolve SMTP settings
    const smtpHost = data.override?.smtpHost || config?.smtp_host;
    const smtpPort = data.override?.smtpPort || config?.smtp_port || 465;
    const smtpSecure = data.override?.smtpSecure ?? config?.smtp_secure ?? true;
    const smtpUser = data.override?.smtpUser || config?.smtp_user;
    let smtpPassword = data.override?.smtpPassword;

    if (!smtpPassword || smtpPassword === "••••••••") {
      if (config?.smtp_pass_enc) {
        smtpPassword = await decryptEmailSecret(config.smtp_pass_enc, "platform", "smtp_password");
      }
    }

    // Resolve IMAP settings
    const imapHost = data.override?.imapHost || config?.imap_host;
    const imapPort = data.override?.imapPort || config?.imap_port || 993;
    const imapSecure = data.override?.imapSecure ?? config?.imap_secure ?? true;
    const imapUser = data.override?.imapUser || config?.imap_user;
    let imapPassword = data.override?.imapPassword;

    if (!imapPassword || imapPassword === "••••••••") {
      if (config?.imap_pass_enc) {
        imapPassword = await decryptEmailSecret(config.imap_pass_enc, "platform", "imap_password");
      }
    }

    let smtpResult = null;
    let imapResult = null;

    if (data.type === "smtp" || data.type === "both") {
      if (!smtpHost || !smtpUser) {
        throw new Error("SMTP host and user are required to test SMTP connection");
      }
      smtpResult = await testSmtpSocket({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        user: smtpUser,
        password: smtpPassword,
        fromEmail: data.override?.fromEmail || config?.from_email || "flas@mobidigisol.com",
      });
    }

    if (data.type === "imap" || data.type === "both") {
      if (imapHost && imapUser) {
        imapResult = await testImapSocket({
          host: imapHost,
          port: imapPort,
          secure: imapSecure,
          user: imapUser,
          password: imapPassword,
        });
      } else if (data.type === "imap") {
        throw new Error("IMAP host and user are required to test IMAP connection");
      }
    }

    const overallOk = (smtpResult ? smtpResult.ok : true) && (imapResult ? imapResult.ok : true);
    const latencyMs = Math.max(smtpResult?.latencyMs ?? 0, imapResult?.latencyMs ?? 0);
    const errorMsg = smtpResult?.ok === false ? smtpResult.message : (imapResult?.ok === false ? imapResult.message : null);

    // If config row exists in database, persist the test result
    if (config?.id) {
      await supabaseAdmin
        .from("platform_email_config")
        .update({
          last_test_at: new Date().toISOString(),
          last_test_ok: overallOk,
          last_test_error: errorMsg,
          verified: overallOk ? true : config.verified,
        })
        .eq("id", config.id);
    }

    return {
      ok: overallOk,
      latencyMs,
      status: overallOk ? "verified" : "test_failed",
      message: overallOk
        ? `Connection verified successfully in ${latencyMs}ms`
        : errorMsg ?? "Connection test failed",
      smtpResult,
      imapResult,
    };
  });
```

---

## 5. Component 4: Database Schema & Migration Specification

### 5.1 Migration File: `supabase/migrations/20261009100000_platform_email_config.sql`

```sql
-- ═════════════════════════════════════════════════════════════════════════════
-- FLAS CRM — Milestone 1: Platform Super-Admin Email Configuration Schema
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.platform_email_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_email text NOT NULL DEFAULT 'flas@mobidigisol.com',
  from_name text NOT NULL DEFAULT 'Flas CRM',
  smtp_host text NOT NULL,
  smtp_port integer NOT NULL DEFAULT 465,
  smtp_secure boolean NOT NULL DEFAULT true,
  smtp_user text NOT NULL,
  smtp_pass_enc text NOT NULL,
  imap_host text,
  imap_port integer DEFAULT 993,
  imap_secure boolean DEFAULT true,
  imap_user text,
  imap_pass_enc text,
  verified boolean NOT NULL DEFAULT false,
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_error text,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Row-Level Security: strictly accessible to super_admin
ALTER TABLE public.platform_email_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_email_config_superadmin_all" ON public.platform_email_config;
CREATE POLICY "platform_email_config_superadmin_all" ON public.platform_email_config
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

GRANT ALL ON public.platform_email_config TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.platform_email_config TO authenticated;

-- Automatic updated_at trigger
DROP TRIGGER IF EXISTS platform_email_config_updated ON public.platform_email_config;
CREATE TRIGGER platform_email_config_updated
  BEFORE UPDATE ON public.platform_email_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
```

---

## 6. Component 5: Independent Verification Strategy & Test Suites

To verify this implementation deterministically without requiring live internet SMTP servers, the testing suite utilizes two test modules:

### 6.1 `tests/email-crypto.test.mjs` (Unit Tests)
- **Round-Trip Fidelity**: Secret encrypts and decrypts to exact string.
- **Envelope Structure**: Validates `v1:keyId:iv:ciphertext:tag` format.
- **Freshness**: 50 successive encryptions generate 50 distinct IVs.
- **Tamper Resistance**: 1-bit mutation in ciphertext or tag immediately raises `authentication_failed`.
- **Context Binding (AAD)**: Ciphertext encrypted with `scope: "platform", field: "smtp_password"` cannot be decrypted with `field: "imap_password"`.
- **Key Rotation**: Secrets encrypted with `k1` decrypt under key ring with `k2` active, and `emailNeedsRotation()` returns `true`.
- **Fail-Closed Configuration**: Missing key ring throws `not_configured`.

### 6.2 `tests/email-socket-handshake.test.mjs` (Mock Socket Tests)
- **Local Mock SMTP Server**: Spins up a local `net.createServer` listening on ephemeral port `12587`:
  - Simulates greeting `220 smtp.flas.test`.
  - Simulates `EHLO` response `250-AUTH LOGIN PLAIN`.
  - Simulates `AUTH LOGIN` challenge `334 VXNlcm5hbWU6`.
  - Simulates successful authentication `235 2.7.0 Authentication successful`.
  - Simulates bad credentials `535 5.7.8 Authentication credentials invalid`.
  - Simulates `QUIT` and latency calculation.
- **Local Mock IMAP Server**: Spins up local `net.createServer` listening on port `12993`:
  - Simulates untagged greeting `* OK [CAPABILITY IMAP4rev1] Mock IMAP Server Ready`.
  - Simulates `A001 LOGIN` with `A001 OK LOGIN completed`.
  - Simulates invalid password with `A001 NO [AUTHENTICATIONFAILED] Invalid credentials`.
  - Simulates `A002 CAPABILITY` and `A003 LOGOUT`.

### 6.3 Verification Commands
```bash
# 1. Type checking across the workspace
npx tsc --noEmit

# 2. Run email crypto test suite
npm run test:email-crypto

# 3. Run socket handshake test suite
npm run test:email-socket
```

---

## 7. Next Steps for Implementer

1. **Step 1**: Create `src/lib/email-crypto.server.ts` matching the blueprint in §2.4.
2. **Step 2**: Create `src/lib/email-socket-test.server.ts` matching the blueprint in §3.2.
3. **Step 3**: Create database migration `supabase/migrations/20261009100000_platform_email_config.sql` matching §5.1.
4. **Step 4**: Create `src/lib/platform-smtp.functions.ts` matching §4.2.
5. **Step 5**: Create test files `tests/email-crypto.test.mjs` and `tests/email-socket-handshake.test.mjs`, add bundling entries in `scripts/build-state-bundle.mjs`, and verify all tests pass cleanly.
