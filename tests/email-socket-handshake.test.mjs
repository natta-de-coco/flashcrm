import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { build } from "esbuild";

await build({
  entryPoints: ["src/lib/email-socket-test.server.ts"],
  outfile: "node_modules/.cache/flas-email-socket.mjs",
  format: "esm",
  platform: "node",
  bundle: true,
  logLevel: "error",
});

const socketTest = await import("../node_modules/.cache/flas-email-socket.mjs");

describe("email-socket-handshake: SMTP Mock Server", () => {
  let smtpServer;
  let smtpPort = 0;

  before(async () => {
    smtpServer = net.createServer((socket) => {
      let state = "greeting";
      socket.write("220 smtp.flas.test ESMTP Service Ready\r\n");

      socket.on("error", () => {});
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        while (buffer.includes("\r\n")) {
          const idx = buffer.indexOf("\r\n");
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);

          if (line.startsWith("EHLO")) {
            socket.write("250-smtp.flas.test greets flas\r\n250-AUTH LOGIN\r\n250-8BITMIME\r\n250 OK\r\n");
            state = "ehlo";
          } else if (line === "AUTH LOGIN") {
            socket.write("334 VXNlcm5hbWU6\r\n"); // "Username:" in base64
            state = "auth_user";
          } else if (state === "auth_user") {
            socket.write("334 UGFzc3dvcmQ6\r\n"); // "Password:" in base64
            state = "auth_pass";
          } else if (state === "auth_pass") {
            const decodedPass = Buffer.from(line, "base64").toString("utf8");
            if (decodedPass === "correct_password") {
              socket.write("235 2.7.0 Authentication successful\r\n");
              state = "authenticated";
            } else {
              socket.write("535 5.7.8 Authentication credentials invalid\r\n");
              state = "auth_failed";
            }
          } else if (line.startsWith("MAIL FROM:")) {
            socket.write("250 2.1.0 Sender OK\r\n");
          } else if (line === "RSET") {
            socket.write("250 2.0.0 Reset OK\r\n");
          } else if (line === "QUIT") {
            socket.write("221 2.0.0 Bye\r\n");
            socket.end();
          }
        }
      });
    });

    await new Promise((resolve) => {
      smtpServer.listen(0, "127.0.0.1", () => {
        smtpPort = smtpServer.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    if (smtpServer) {
      await new Promise((resolve) => smtpServer.close(resolve));
    }
  });

  test("SMTP test succeeds with valid credentials and measures latency", async () => {
    const res = await socketTest.testSmtpSocket({
      host: "127.0.0.1",
      port: smtpPort,
      secure: false,
      user: "flas@mobidigisol.com",
      password: "correct_password",
      fromEmail: "flas@mobidigisol.com",
    });

    assert.equal(res.ok, true);
    assert.equal(res.status, "authenticated");
    assert.ok(res.latencyMs >= 0);
    assert.ok(res.greeting?.includes("220 smtp.flas.test"));
    assert.ok(res.stepsCompleted.some((s) => s.includes("Authentication succeeded")));
  });

  test("SMTP test detects credential authentication failure", async () => {
    const res = await socketTest.testSmtpSocket({
      host: "127.0.0.1",
      port: smtpPort,
      secure: false,
      user: "flas@mobidigisol.com",
      password: "wrong_password",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, "auth_failed");
    assert.ok(res.message.includes("Authentication failed"));
  });

  test("SMTP test connects without auth if credentials omitted", async () => {
    const res = await socketTest.testSmtpSocket({
      host: "127.0.0.1",
      port: smtpPort,
      secure: false,
    });

    assert.equal(res.ok, true);
    assert.equal(res.status, "connected");
  });

  test("SMTP test handles connection refusal on closed port", async () => {
    const res = await socketTest.testSmtpSocket({
      host: "127.0.0.1",
      port: 59998, // Port not listening
      secure: false,
      timeoutMs: 1000,
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, "connection_refused");
  });
});

describe("email-socket-handshake: IMAP Mock Server", () => {
  let imapServer;
  let imapPort = 0;

  before(async () => {
    imapServer = net.createServer((socket) => {
      socket.write("* OK [CAPABILITY IMAP4rev1] Mock IMAP Server Ready\r\n");

      socket.on("error", () => {});
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        while (buffer.includes("\r\n")) {
          const idx = buffer.indexOf("\r\n");
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);

          if (line.startsWith("A001 LOGIN")) {
            if (line.includes("correct_password")) {
              socket.write("A001 OK LOGIN completed\r\n");
            } else {
              socket.write("A001 NO [AUTHENTICATIONFAILED] Invalid credentials\r\n");
            }
          } else if (line.startsWith("A002 CAPABILITY")) {
            socket.write("* CAPABILITY IMAP4rev1\r\nA002 OK CAPABILITY completed\r\n");
          } else if (line.startsWith("A003 LOGOUT")) {
            socket.write("* BYE Logging out\r\nA003 OK LOGOUT completed\r\n");
            socket.end();
          }
        }
      });
    });

    await new Promise((resolve) => {
      imapServer.listen(0, "127.0.0.1", () => {
        imapPort = imapServer.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    if (imapServer) {
      await new Promise((resolve) => imapServer.close(resolve));
    }
  });

  test("IMAP test succeeds with valid credentials and measures latency", async () => {
    const res = await socketTest.testImapSocket({
      host: "127.0.0.1",
      port: imapPort,
      secure: false,
      user: "flas@mobidigisol.com",
      password: "correct_password",
    });

    assert.equal(res.ok, true);
    assert.equal(res.status, "authenticated");
    assert.ok(res.latencyMs >= 0);
    assert.ok(res.greeting?.includes("* OK"));
    assert.ok(res.stepsCompleted.some((s) => s.includes("IMAP authentication succeeded")));
  });

  test("IMAP test detects credential authentication failure", async () => {
    const res = await socketTest.testImapSocket({
      host: "127.0.0.1",
      port: imapPort,
      secure: false,
      user: "flas@mobidigisol.com",
      password: "wrong_password",
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, "auth_failed");
    assert.ok(res.message.includes("IMAP LOGIN failed"));
  });

  test("IMAP test handles connection refusal on closed port", async () => {
    const res = await socketTest.testImapSocket({
      host: "127.0.0.1",
      port: 59998,
      secure: false,
      timeoutMs: 1000,
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, "connection_refused");
  });
});
