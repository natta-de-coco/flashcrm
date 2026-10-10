import { test, describe, afterEach } from "node:test";
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

let activeServers = [];
let activeSockets = [];

const createMockServer = (connectionHandler, listenPort = 0) => {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      activeSockets.push(socket);
      socket.on("error", () => {});
      connectionHandler(socket);
    });
    server.on("error", (err) => reject(err));
    server.listen(listenPort, "127.0.0.1", () => {
      const port = server.address().port;
      activeServers.push(server);
      resolve({ server, port });
    });
  });
};

afterEach(async () => {
  for (const sock of activeSockets) {
    try {
      sock.destroy();
    } catch {}
  }
  activeSockets = [];

  while (activeServers.length > 0) {
    const s = activeServers.pop();
    if (s) {
      if (typeof s.closeAllConnections === "function") {
        s.closeAllConnections();
      }
      await new Promise((res) => s.close(res));
    }
  }
});

describe("email-socket-stress: SMTP Port Timeouts & Hung Connections", () => {
  test("SMTP server accepts TCP connection but hangs indefinitely before greeting", async () => {
    const { port } = await createMockServer((socket) => {
      // Intentionally do not send greeting
    });

    const res = await socketTest.testSmtpSocket({
      host: "127.0.0.1",
      port,
      secure: false,
      timeoutMs: 250,
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, "timeout");
    assert.ok(res.message.includes("timed out"));
    assert.ok(res.latencyMs >= 200);
  });

  test("SMTP server sends greeting but hangs on EHLO command", async () => {
    const { port } = await createMockServer((socket) => {
      socket.write("220 mock.smtp.test ESMTP Service Ready\r\n");
      // Do not respond to EHLO
    });

    const res = await socketTest.testSmtpSocket({
      host: "127.0.0.1",
      port,
      secure: false,
      timeoutMs: 250,
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, "timeout");
    assert.ok(res.stepsCompleted.some((s) => s.includes("Received greeting")));
  });

  test("SMTP server sends greeting and EHLO but hangs on AUTH LOGIN", async () => {
    const { port } = await createMockServer((socket) => {
      socket.write("220 mock.smtp.test ESMTP Service Ready\r\n");
      let buf = "";
      socket.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        if (buf.includes("EHLO")) {
          socket.write("250-mock.smtp.test\r\n250-AUTH LOGIN\r\n250 OK\r\n");
          buf = "";
        }
        // Do not respond to AUTH LOGIN
      });
    });

    const res = await socketTest.testSmtpSocket({
      host: "127.0.0.1",
      port,
      secure: false,
      user: "flas@mobidigisol.com",
      password: "secret_password",
      timeoutMs: 250,
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, "timeout");
    assert.ok(res.stepsCompleted.some((s) => s.includes("EHLO accepted")));
  });

  test("SMTP server hangs on password submission", async () => {
    let authStage = 0;
    const { port } = await createMockServer((socket) => {
      socket.write("220 mock.smtp.test ESMTP Service Ready\r\n");
      let buf = "";
      socket.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        if (authStage === 0 && buf.includes("EHLO")) {
          socket.write("250-mock.smtp.test\r\n250-AUTH LOGIN\r\n250 OK\r\n");
          buf = "";
        } else if (authStage === 0 && buf.includes("AUTH LOGIN")) {
          authStage = 1;
          socket.write("334 VXNlcm5hbWU6\r\n");
          buf = "";
        } else if (authStage === 1 && buf.includes("\r\n")) {
          authStage = 2;
          socket.write("334 UGFzc3dvcmQ6\r\n");
          buf = "";
        } else if (authStage === 2) {
          // Received password: deliberately hang without responding
        }
      });
    });

    const res = await socketTest.testSmtpSocket({
      host: "127.0.0.1",
      port,
      secure: false,
      user: "flas@mobidigisol.com",
      password: "secret_password",
      timeoutMs: 250,
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, "timeout");
  });
});

describe("email-socket-stress: SMTP Abrupt Dropped Connections", () => {
  test("SMTP server abruptly terminates socket immediately upon connect", async () => {
    const { port } = await createMockServer((socket) => {
      socket.destroy();
    });

    const res = await socketTest.testSmtpSocket({
      host: "127.0.0.1",
      port,
      secure: false,
      timeoutMs: 250,
    });

    assert.equal(res.ok, false);
    assert.ok(["protocol_error", "timeout"].includes(res.status));
  });

  test("SMTP server sends greeting and drops socket upon receiving EHLO", async () => {
    const { port } = await createMockServer((socket) => {
      socket.write("220 mock.smtp.test Service Ready\r\n");
      socket.on("data", (chunk) => {
        if (chunk.toString().includes("EHLO")) {
          socket.destroy();
        }
      });
    });

    const res = await socketTest.testSmtpSocket({
      host: "127.0.0.1",
      port,
      secure: false,
      timeoutMs: 250,
    });

    assert.equal(res.ok, false);
    assert.ok(["protocol_error", "timeout"].includes(res.status));
  });

  test("SMTP server drops socket during authentication handshake", async () => {
    const { port } = await createMockServer((socket) => {
      socket.write("220 mock.smtp.test Service Ready\r\n");
      let buf = "";
      socket.on("data", (chunk) => {
        buf += chunk.toString();
        if (buf.includes("EHLO")) {
          socket.write("250-mock.smtp.test\r\n250-AUTH LOGIN\r\n250 OK\r\n");
          buf = "";
        } else if (buf.includes("AUTH LOGIN")) {
          socket.write("334 VXNlcm5hbWU6\r\n");
          buf = "";
        } else if (buf.includes("\r\n")) {
          socket.destroy(new Error("Simulated peer disconnect"));
        }
      });
    });

    const res = await socketTest.testSmtpSocket({
      host: "127.0.0.1",
      port,
      secure: false,
      user: "flas@mobidigisol.com",
      password: "secret_password",
      timeoutMs: 250,
    });

    assert.equal(res.ok, false);
  });
});

describe("email-socket-stress: SMTP Unexpected Greeting & Protocol Codes", () => {
  test("SMTP greeting with 554 Service Unavailable rejects with protocol_error", async () => {
    const { port } = await createMockServer((socket) => {
      socket.write("554 5.7.1 Client IP blocked by policy\r\n");
    });

    const res = await socketTest.testSmtpSocket({
      host: "127.0.0.1",
      port,
      secure: false,
      timeoutMs: 300,
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, "protocol_error");
    assert.ok(res.message.includes("Unexpected greeting code: 554"));
  });

  test("SMTP greeting with 421 Service not available rejects with protocol_error", async () => {
    const { port } = await createMockServer((socket) => {
      socket.write("421 4.7.0 Server busy, try again later\r\n");
    });

    const res = await socketTest.testSmtpSocket({
      host: "127.0.0.1",
      port,
      secure: false,
      timeoutMs: 300,
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, "protocol_error");
    assert.ok(res.message.includes("421"));
  });

  test("SMTP greeting with malformed non-standard text rejects with protocol_error", async () => {
    const { port } = await createMockServer((socket) => {
      socket.write("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nHello\r\n");
    });

    const res = await socketTest.testSmtpSocket({
      host: "127.0.0.1",
      port,
      secure: false,
      timeoutMs: 300,
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, "protocol_error");
    assert.ok(res.message.includes("Invalid SMTP response format"));
  });

  test("SMTP EHLO rejected with 500 syntax error", async () => {
    const { port } = await createMockServer((socket) => {
      socket.write("220 mock.smtp.test Service Ready\r\n");
      socket.on("data", (chunk) => {
        if (chunk.toString().includes("EHLO")) {
          socket.write("500 5.5.2 Syntax error in EHLO\r\n");
        }
      });
    });

    const res = await socketTest.testSmtpSocket({
      host: "127.0.0.1",
      port,
      secure: false,
      timeoutMs: 300,
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, "protocol_error");
    assert.ok(res.message.includes("EHLO rejected"));
  });
});

describe("email-socket-stress: SMTP Malformed Auth Challenges & Responses", () => {
  test("SMTP AUTH LOGIN rejected with 504 Unrecognized auth type", async () => {
    const { port } = await createMockServer((socket) => {
      socket.write("220 mock.smtp.test Service Ready\r\n");
      let buf = "";
      socket.on("data", (chunk) => {
        buf += chunk.toString();
        if (buf.includes("EHLO")) {
          socket.write("250-mock.smtp.test\r\n250-AUTH PLAIN\r\n250 OK\r\n");
          buf = "";
        } else if (buf.includes("AUTH LOGIN")) {
          socket.write("504 5.7.4 Unrecognized authentication type\r\n");
          buf = "";
        }
      });
    });

    const res = await socketTest.testSmtpSocket({
      host: "127.0.0.1",
      port,
      secure: false,
      user: "flas@mobidigisol.com",
      password: "secret_password",
      timeoutMs: 300,
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, "auth_failed");
    assert.ok(res.message.includes("AUTH LOGIN not supported or rejected"));
  });

  test("SMTP username challenged with 535 rejection returns auth_failed", async () => {
    const { port } = await createMockServer((socket) => {
      socket.write("220 mock.smtp.test Service Ready\r\n");
      let buf = "";
      socket.on("data", (chunk) => {
        buf += chunk.toString();
        if (buf.includes("EHLO")) {
          socket.write("250-mock.smtp.test\r\n250-AUTH LOGIN\r\n250 OK\r\n");
          buf = "";
        } else if (buf.includes("AUTH LOGIN")) {
          socket.write("334 VXNlcm5hbWU6\r\n");
          buf = "";
        } else if (buf.includes("\r\n")) {
          socket.write("535 5.7.8 User not found\r\n");
        }
      });
    });

    const res = await socketTest.testSmtpSocket({
      host: "127.0.0.1",
      port,
      secure: false,
      user: "nonexistent@mobidigisol.com",
      password: "secret_password",
      timeoutMs: 300,
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, "auth_failed");
    assert.ok(res.message.includes("Username rejected"));
  });

  test("SMTP password challenged with 451 temporary auth failure returns auth_failed", async () => {
    const { port } = await createMockServer((socket) => {
      socket.write("220 mock.smtp.test Service Ready\r\n");
      let buf = "";
      socket.on("data", (chunk) => {
        buf += chunk.toString();
        if (buf.includes("EHLO")) {
          socket.write("250-mock.smtp.test\r\n250-AUTH LOGIN\r\n250 OK\r\n");
          buf = "";
        } else if (buf.includes("AUTH LOGIN")) {
          socket.write("334 VXNlcm5hbWU6\r\n");
          buf = "";
        } else if (buf.includes(Buffer.from("flas@mobidigisol.com").toString("base64"))) {
          socket.write("334 UGFzc3dvcmQ6\r\n");
          buf = "";
        } else if (buf.includes("\r\n")) {
          socket.write("451 4.7.0 Temporary authentication database error\r\n");
        }
      });
    });

    const res = await socketTest.testSmtpSocket({
      host: "127.0.0.1",
      port,
      secure: false,
      user: "flas@mobidigisol.com",
      password: "secret_password",
      timeoutMs: 300,
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, "auth_failed");
    assert.ok(res.message.includes("Authentication failed (code 451)"));
  });

  test("SMTP STARTTLS command rejected on port 587 returns tls_error", async (t) => {
    let mock;
    try {
      mock = await createMockServer((socket) => {
        socket.write("220 mock.smtp.test Service Ready\r\n");
        let buf = "";
        socket.on("data", (chunk) => {
          buf += chunk.toString();
          if (buf.includes("EHLO")) {
            socket.write("250-mock.smtp.test\r\n250-STARTTLS\r\n250 OK\r\n");
            buf = "";
          } else if (buf.includes("STARTTLS")) {
            socket.write("454 4.7.0 TLS not available due to temporary problem\r\n");
          }
        });
      }, 587);
    } catch {
      t.skip("Port 587 unavailable in current test environment");
      return;
    }

    const res = await socketTest.testSmtpSocket({
      host: "127.0.0.1",
      port: 587,
      secure: false,
      timeoutMs: 300,
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, "tls_error");
    assert.ok(res.message.includes("STARTTLS refused by server"));
  });
});

describe("email-socket-stress: IMAP Port Timeouts & Dropped Connections", () => {
  test("IMAP server accepts TCP connection but hangs indefinitely before greeting", async () => {
    const { port } = await createMockServer((socket) => {
      // Do nothing
    });

    const res = await socketTest.testImapSocket({
      host: "127.0.0.1",
      port,
      secure: false,
      timeoutMs: 250,
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, "timeout");
  });

  test("IMAP server sends greeting but hangs on A001 LOGIN", async () => {
    const { port } = await createMockServer((socket) => {
      socket.write("* OK [CAPABILITY IMAP4rev1] Mock IMAP Server Ready\r\n");
      // Do not respond to LOGIN
    });

    const res = await socketTest.testImapSocket({
      host: "127.0.0.1",
      port,
      secure: false,
      user: "flas@mobidigisol.com",
      password: "secret_password",
      timeoutMs: 250,
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, "timeout");
    assert.ok(res.stepsCompleted.some((s) => s.includes("Received greeting")));
  });

  test("IMAP server abruptly drops socket immediately upon connect", async () => {
    const { port } = await createMockServer((socket) => {
      socket.destroy();
    });

    const res = await socketTest.testImapSocket({
      host: "127.0.0.1",
      port,
      secure: false,
      timeoutMs: 250,
    });

    assert.equal(res.ok, false);
    assert.ok(["protocol_error", "timeout"].includes(res.status));
  });

  test("IMAP server drops socket during LOGIN command execution", async () => {
    const { port } = await createMockServer((socket) => {
      socket.write("* OK Mock IMAP Server Ready\r\n");
      socket.on("data", (chunk) => {
        if (chunk.toString().includes("A001 LOGIN")) {
          socket.destroy();
        }
      });
    });

    const res = await socketTest.testImapSocket({
      host: "127.0.0.1",
      port,
      secure: false,
      user: "flas@mobidigisol.com",
      password: "secret_password",
      timeoutMs: 250,
    });

    assert.equal(res.ok, false);
  });
});

describe("email-socket-stress: IMAP Unexpected Greeting & Malformed Responses", () => {
  test("IMAP greeting with * BAD rejects with protocol_error", async () => {
    const { port } = await createMockServer((socket) => {
      socket.write("* BAD Service unavailable\r\n");
    });

    const res = await socketTest.testImapSocket({
      host: "127.0.0.1",
      port,
      secure: false,
      timeoutMs: 300,
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, "protocol_error");
    assert.ok(res.message.includes("Unexpected IMAP greeting"));
  });

  test("IMAP greeting with * NO rejects with protocol_error", async () => {
    const { port } = await createMockServer((socket) => {
      socket.write("* NO Server down for maintenance\r\n");
    });

    const res = await socketTest.testImapSocket({
      host: "127.0.0.1",
      port,
      secure: false,
      timeoutMs: 300,
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, "protocol_error");
  });

  test("IMAP greeting with * BYE rejects with protocol_error", async () => {
    const { port } = await createMockServer((socket) => {
      socket.write("* BYE Autologout; connection limit exceeded\r\n");
    });

    const res = await socketTest.testImapSocket({
      host: "127.0.0.1",
      port,
      secure: false,
      timeoutMs: 300,
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, "protocol_error");
  });

  test("IMAP greeting with non-IMAP HTTP protocol rejects with protocol_error", async () => {
    const { port } = await createMockServer((socket) => {
      socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
    });

    const res = await socketTest.testImapSocket({
      host: "127.0.0.1",
      port,
      secure: false,
      timeoutMs: 300,
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, "protocol_error");
  });

  test("IMAP LOGIN command rejected with A001 NO returns auth_failed", async () => {
    const { port } = await createMockServer((socket) => {
      socket.write("* OK Mock IMAP Ready\r\n");
      socket.on("data", (chunk) => {
        if (chunk.toString().includes("A001 LOGIN")) {
          socket.write("A001 NO [AUTHENTICATIONFAILED] Invalid credentials\r\n");
        }
      });
    });

    const res = await socketTest.testImapSocket({
      host: "127.0.0.1",
      port,
      secure: false,
      user: "flas@mobidigisol.com",
      password: "bad_password",
      timeoutMs: 300,
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, "auth_failed");
    assert.ok(res.message.includes("IMAP LOGIN failed"));
  });

  test("IMAP LOGIN command rejected with A001 BAD returns protocol_error", async () => {
    const { port } = await createMockServer((socket) => {
      socket.write("* OK Mock IMAP Ready\r\n");
      socket.on("data", (chunk) => {
        if (chunk.toString().includes("A001 LOGIN")) {
          socket.write("A001 BAD Syntax error in LOGIN parameters\r\n");
        }
      });
    });

    const res = await socketTest.testImapSocket({
      host: "127.0.0.1",
      port,
      secure: false,
      user: "flas@mobidigisol.com",
      password: "bad_password",
      timeoutMs: 300,
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, "protocol_error");
    assert.ok(res.message.includes("IMAP LOGIN failed"));
  });

  test("IMAP server sends unsolicited untagged alerts before tagged response", async () => {
    const { port } = await createMockServer((socket) => {
      socket.write("* OK Mock IMAP Ready\r\n");
      socket.on("data", (chunk) => {
        const str = chunk.toString();
        if (str.includes("A001 LOGIN")) {
          socket.write("* ALERT Authorized personnel only\r\n* CAPABILITY IMAP4rev1\r\nA001 OK LOGIN completed\r\n");
        } else if (str.includes("A002 CAPABILITY")) {
          socket.write("* CAPABILITY IMAP4rev1\r\nA002 OK CAPABILITY completed\r\n");
        } else if (str.includes("A003 LOGOUT")) {
          socket.write("* BYE Logging out\r\nA003 OK LOGOUT completed\r\n");
        }
      });
    });

    const res = await socketTest.testImapSocket({
      host: "127.0.0.1",
      port,
      secure: false,
      user: "flas@mobidigisol.com",
      password: "valid_pass",
      timeoutMs: 300,
    });

    assert.equal(res.ok, true);
    assert.equal(res.status, "authenticated");
    assert.ok(res.stepsCompleted.some((s) => s.includes("IMAP authentication succeeded")));
  });

  test("IMAP credentials with quotes and backslashes are properly escaped in command", async () => {
    let capturedLoginCommand = "";
    const { port } = await createMockServer((socket) => {
      socket.write("* OK Mock IMAP Ready\r\n");
      socket.on("data", (chunk) => {
        const str = chunk.toString();
        if (str.includes("A001 LOGIN")) {
          capturedLoginCommand = str;
          socket.write("A001 OK LOGIN completed\r\n");
        } else if (str.includes("A002 CAPABILITY")) {
          socket.write("A002 OK CAPABILITY completed\r\n");
        } else if (str.includes("A003 LOGOUT")) {
          socket.write("A003 OK LOGOUT completed\r\n");
        }
      });
    });

    const userWithSpecial = 'user"with\\slash@test.com';
    const passWithSpecial = 'pass"with\\quote';
    const res = await socketTest.testImapSocket({
      host: "127.0.0.1",
      port,
      secure: false,
      user: userWithSpecial,
      password: passWithSpecial,
      timeoutMs: 300,
    });

    assert.equal(res.ok, true);
    assert.ok(capturedLoginCommand.includes('A001 LOGIN "user\\"with\\\\slash@test.com" "pass\\"with\\\\quote"'));
  });
});

describe("email-socket-stress: Network Connection Edge Cases", () => {
  test("connection to unallocated/closed local port returns connection_refused", async () => {
    const res = await socketTest.testSmtpSocket({
      host: "127.0.0.1",
      port: 59981,
      secure: false,
      timeoutMs: 300,
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, "connection_refused");
    assert.ok(res.message.includes("SMTP test failed"));
  });

  test("non-existent DNS host returns host_unreachable", async () => {
    const res = await socketTest.testSmtpSocket({
      host: "nonexistent-mail-domain-flas-test-999.invalid",
      port: 587,
      secure: false,
      timeoutMs: 500,
    });

    assert.equal(res.ok, false);
    assert.equal(res.status, "host_unreachable");
  });
});
