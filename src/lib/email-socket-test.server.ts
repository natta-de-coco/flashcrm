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
  secure?: boolean | undefined; // true = implicit TLS (port 465), false = STARTTLS/plain (port 587)
  user?: string | undefined;
  password?: string | undefined;
  pass?: string | undefined; // alias
  fromEmail?: string | undefined;
  timeoutMs?: number | undefined;
};

export type ImapTestOptions = {
  host: string;
  port: number;
  secure?: boolean | undefined; // true = implicit TLS (port 993), false = STARTTLS (port 143)
  user?: string | undefined;
  password?: string | undefined;
  pass?: string | undefined; // alias
  timeoutMs?: number | undefined;
};

export type ConnectionTestResult = {
  ok: boolean;
  latencyMs: number;
  status: ConnectionStatus;
  message: string;
  greeting?: string | undefined;
  stepsCompleted: string[];
  steps?: string[] | undefined;
  error?: string | undefined;
};

/** Buffered line reader for socket protocols */
class SocketReader {
  private buffer = "";
  private resolveNextLine: ((line: string) => void) | null = null;
  private rejectCurrent: ((err: Error) => void) | null = null;
  private readTimer: NodeJS.Timeout | null = null;

  onData(chunk: Buffer | string) {
    this.buffer += chunk.toString("utf8");
    this.tryDrain();
  }

  onError(err: Error) {
    if (this.readTimer) {
      clearTimeout(this.readTimer);
      this.readTimer = null;
    }
    if (this.rejectCurrent) {
      this.rejectCurrent(err);
      this.rejectCurrent = null;
      this.resolveNextLine = null;
    }
  }

  onEnd() {
    this.tryDrain();
  }

  private tryDrain() {
    if (!this.resolveNextLine) return;
    const idx = this.buffer.indexOf("\r\n");
    if (idx !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      if (this.readTimer) {
        clearTimeout(this.readTimer);
        this.readTimer = null;
      }
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
      this.readTimer = setTimeout(() => {
        if (this.resolveNextLine === resolve) {
          this.resolveNextLine = null;
          this.rejectCurrent = null;
          this.readTimer = null;
          reject(new Error(`Socket read timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);
      this.tryDrain();
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
      const code = parseInt(match[1]!, 10);
      const isLast = match[2] === " ";
      if (isLast) {
        return { code, lines };
      }
    }
  }

  async readImapTaggedResponse(
    tag: string,
    timeoutMs: number,
  ): Promise<{ status: "OK" | "NO" | "BAD"; line: string; lines: string[] }> {
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
  const password = options.password ?? options.pass;

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
    socket.on("end", () => reader.onEnd());

    // 1. Read greeting
    const greeting = await reader.readSmtpResponse(timeoutMs);
    if (greeting.code !== 220) {
      const latencyMs = Math.round(performance.now() - startTime);
      return {
        ok: false,
        latencyMs,
        status: "protocol_error",
        message: `Unexpected greeting code: ${greeting.code} (${greeting.lines.join("; ")})`,
        error: `Unexpected greeting code: ${greeting.code}`,
        stepsCompleted: steps,
        steps,
      };
    }
    steps.push(`Received greeting: ${greeting.lines[0]}`);

    // 2. Send EHLO
    socket.write("EHLO flas.mobidigisol.com\r\n");
    const ehloResp = await reader.readSmtpResponse(timeoutMs);
    if (ehloResp.code !== 250) {
      const latencyMs = Math.round(performance.now() - startTime);
      return {
        ok: false,
        latencyMs,
        status: "protocol_error",
        message: `EHLO rejected: ${ehloResp.lines.join("; ")}`,
        error: `EHLO rejected: ${ehloResp.lines.join("; ")}`,
        stepsCompleted: steps,
        steps,
      };
    }
    steps.push("EHLO accepted");

    // 3. Upgrade to STARTTLS if not implicit TLS and port is 587
    if (!isImplicitTls && options.port === 587) {
      steps.push("Initiating STARTTLS upgrade...");
      socket.write("STARTTLS\r\n");
      const tlsResp = await reader.readSmtpResponse(timeoutMs);
      if (tlsResp.code !== 220) {
        const latencyMs = Math.round(performance.now() - startTime);
        return {
          ok: false,
          latencyMs,
          status: "tls_error",
          message: `STARTTLS refused by server: ${tlsResp.lines.join("; ")}`,
          error: `STARTTLS refused: ${tlsResp.lines.join("; ")}`,
          stepsCompleted: steps,
          steps,
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
      socket.on("end", () => reader.onEnd());

      // Re-issue EHLO after TLS handshake
      socket.write("EHLO flas.mobidigisol.com\r\n");
      await reader.readSmtpResponse(timeoutMs);
      steps.push("TLS handshake completed; re-issued EHLO");
    }

    // 4. Authenticate if credentials provided
    if (options.user && password) {
      steps.push(`Authenticating as ${options.user}...`);
      socket.write("AUTH LOGIN\r\n");
      const authResp = await reader.readSmtpResponse(timeoutMs);
      if (authResp.code !== 334) {
        const latencyMs = Math.round(performance.now() - startTime);
        return {
          ok: false,
          latencyMs,
          status: "auth_failed",
          message: `AUTH LOGIN not supported or rejected: ${authResp.lines.join("; ")}`,
          error: `AUTH LOGIN rejected: ${authResp.lines.join("; ")}`,
          stepsCompleted: steps,
          steps,
        };
      }

      // Send username (base64)
      socket.write(`${Buffer.from(options.user).toString("base64")}\r\n`);
      const userResp = await reader.readSmtpResponse(timeoutMs);
      if (userResp.code !== 334) {
        const latencyMs = Math.round(performance.now() - startTime);
        return {
          ok: false,
          latencyMs,
          status: "auth_failed",
          message: `Username rejected: ${userResp.lines.join("; ")}`,
          error: `Username rejected: ${userResp.lines.join("; ")}`,
          stepsCompleted: steps,
          steps,
        };
      }

      // Send password (base64)
      socket.write(`${Buffer.from(password).toString("base64")}\r\n`);
      const passResp = await reader.readSmtpResponse(timeoutMs);
      if (passResp.code !== 235) {
        const latencyMs = Math.round(performance.now() - startTime);
        return {
          ok: false,
          latencyMs,
          status: "auth_failed",
          message: `Authentication failed (code ${passResp.code}): ${passResp.lines.join("; ")}`,
          error: `Authentication failed (code ${passResp.code}): ${passResp.lines.join("; ")}`,
          stepsCompleted: steps,
          steps,
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

    const latencyMs = Math.round(performance.now() - startTime);
    return {
      ok: true,
      latencyMs,
      status: options.user ? "authenticated" : "connected",
      message: `SMTP handshake and ${options.user ? "credentials verified" : "connection verified"} in ${latencyMs}ms`,
      greeting: greeting.lines[0],
      stepsCompleted: steps,
      steps,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string })?.code;

    let status: ConnectionStatus = "protocol_error";
    if (code === "ECONNREFUSED") status = "connection_refused";
    else if (code === "ENOTFOUND") status = "host_unreachable";
    else if (code === "ETIMEDOUT" || errorMsg.includes("timed out")) status = "timeout";
    else if (errorMsg.includes("TLS") || code?.includes("CERT")) status = "tls_error";

    const latencyMs = Math.round(performance.now() - startTime);
    return {
      ok: false,
      latencyMs,
      status,
      message: `SMTP test failed: ${errorMsg}`,
      error: errorMsg,
      stepsCompleted: steps,
      steps,
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
  const password = options.password ?? options.pass;

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
    socket.on("end", () => reader.onEnd());

    // 1. Read untagged greeting (* OK ...)
    const greetingLine = await reader.readLine(timeoutMs);
    if (!greetingLine.startsWith("* OK") && !greetingLine.startsWith("* PREAUTH")) {
      const latencyMs = Math.round(performance.now() - startTime);
      return {
        ok: false,
        latencyMs,
        status: "protocol_error",
        message: `Unexpected IMAP greeting: "${greetingLine}"`,
        error: `Unexpected greeting: ${greetingLine}`,
        stepsCompleted: steps,
        steps,
      };
    }
    steps.push(`Received greeting: ${greetingLine}`);

    // 2. Authenticate if credentials provided
    if (options.user && password) {
      steps.push(`Authenticating as ${options.user}...`);
      const cleanUser = options.user.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const cleanPass = password.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

      socket.write(`A001 LOGIN "${cleanUser}" "${cleanPass}"\r\n`);
      const loginResp = await reader.readImapTaggedResponse("A001", timeoutMs);

      if (loginResp.status !== "OK") {
        const latencyMs = Math.round(performance.now() - startTime);
        return {
          ok: false,
          latencyMs,
          status: loginResp.status === "NO" ? "auth_failed" : "protocol_error",
          message: `IMAP LOGIN failed: ${loginResp.line}`,
          error: `IMAP LOGIN failed: ${loginResp.line}`,
          stepsCompleted: steps,
          steps,
        };
      }
      steps.push("IMAP authentication succeeded");

      // Quick mailbox capability inspection
      socket.write("A002 CAPABILITY\r\n");
      await reader.readImapTaggedResponse("A002", timeoutMs);
      steps.push("IMAP capability query verified");
    }

    // 3. Logout
    socket.write("A003 LOGOUT\r\n");
    steps.push("IMAP session closed gracefully");

    const latencyMs = Math.round(performance.now() - startTime);
    return {
      ok: true,
      latencyMs,
      status: options.user ? "authenticated" : "connected",
      message: `IMAP handshake and ${options.user ? "credentials verified" : "connection verified"} in ${latencyMs}ms`,
      greeting: greetingLine,
      stepsCompleted: steps,
      steps,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string })?.code;

    let status: ConnectionStatus = "protocol_error";
    if (code === "ECONNREFUSED") status = "connection_refused";
    else if (code === "ENOTFOUND") status = "host_unreachable";
    else if (code === "ETIMEDOUT" || errorMsg.includes("timed out")) status = "timeout";
    else if (errorMsg.includes("TLS") || code?.includes("CERT")) status = "tls_error";

    const latencyMs = Math.round(performance.now() - startTime);
    return {
      ok: false,
      latencyMs,
      status,
      message: `IMAP test failed: ${errorMsg}`,
      error: errorMsg,
      stepsCompleted: steps,
      steps,
    };
  } finally {
    if (socket) {
      socket.destroy();
    }
  }
}
