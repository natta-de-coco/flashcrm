// Batch 1 / Task 4 — OAuth security controls that can be tested as pure
// functions: the redirect allowlist, state hashing and secret redaction.
//
//   npm run test:oauth-security
//
// The database-side controls — single-use consumption by hash, replay,
// expiry and the refresh lock — are in supabase/verify/verify-oauth-security.mjs,
// because they are only meaningful against a real Postgres.
//
// MUTATION=open_redirect disables the allowlist. That run MUST fail.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveAllowedOrigin, sha256Hex } from "../node_modules/.cache/flas-oauth.mjs";
import { redactSecrets } from "../node_modules/.cache/flas-redact.mjs";

const MUTATION = process.env.MUTATION ?? "";
const allow = (o) => (MUTATION === "open_redirect" ? new URL(o).origin : resolveAllowedOrigin(o));
if (MUTATION === "open_redirect") {
  console.log("!! MUTATION: redirect allowlist disabled — the suite must FAIL");
}

describe("redirect allowlist", () => {
  const withEnv = (value, fn) => {
    const previous = process.env["OAUTH_ALLOWED_ORIGINS"];
    process.env["OAUTH_ALLOWED_ORIGINS"] = value;
    try {
      fn();
    } finally {
      if (previous === undefined) delete process.env["OAUTH_ALLOWED_ORIGINS"];
      else process.env["OAUTH_ALLOWED_ORIGINS"] = previous;
    }
  };

  test("a configured origin is accepted", () => {
    withEnv("https://flas.example.com", () => {
      assert.equal(allow("https://flas.example.com"), "https://flas.example.com");
    });
  });

  test("a path or query on an allowed origin collapses to the origin", () => {
    withEnv("https://flas.example.com", () => {
      assert.equal(allow("https://flas.example.com/social?x=1"), "https://flas.example.com");
    });
  });

  test("an unrelated origin is refused", () => {
    withEnv("https://flas.example.com", () => {
      assert.equal(allow("https://attacker.test"), null);
    });
  });

  test("a suffix attack is refused", () => {
    // The reason this compares parsed origins rather than string prefixes.
    withEnv("https://flas.example.com", () => {
      assert.equal(allow("https://flas.example.com.attacker.test"), null);
      assert.equal(allow("https://evil-flas.example.com"), null);
    });
  });

  test("a different port is a different origin", () => {
    withEnv("https://flas.example.com", () => {
      assert.equal(allow("https://flas.example.com:8443"), null);
    });
  });

  test("plain http is refused for anything but loopback", () => {
    withEnv("http://flas.example.com", () => {
      assert.equal(allow("http://flas.example.com"), null);
    });
  });

  test("loopback is allowed so development is not blocked", () => {
    withEnv("", () => {
      assert.equal(allow("http://localhost:8080"), "http://localhost:8080");
    });
  });

  test("several configured origins are all honoured", () => {
    withEnv("https://a.example.com, https://b.example.com", () => {
      assert.equal(allow("https://b.example.com"), "https://b.example.com");
      assert.equal(allow("https://c.example.com"), null);
    });
  });

  test("a malformed entry in configuration does not open everything", () => {
    withEnv("not a url, https://a.example.com", () => {
      assert.equal(allow("https://a.example.com"), "https://a.example.com");
      assert.equal(allow("https://anything.test"), null);
    });
  });

  // A bare host in configuration is what took every social connection on the
  // deployment down: the entry could not be parsed, so it matched nothing and
  // said nothing. It is accepted now -- but only as https, and only as a host.
  test("a bare host in configuration is accepted, as https", () => {
    withEnv("flas.example.com", () => {
      assert.equal(allow("https://flas.example.com"), "https://flas.example.com");
    });
  });

  test("a bare host does not also allow plain http", () => {
    withEnv("flas.example.com", () => {
      assert.equal(resolveAllowedOrigin("http://flas.example.com"), null);
    });
  });

  test("a bare host matches that host only, not lookalikes or subdomains", () => {
    withEnv("flas.example.com", () => {
      for (const other of [
        "https://flas.example.com.attacker.test",
        "https://evil-flas.example.com",
        "https://sub.flas.example.com",
      ]) {
        assert.equal(allow(other), null, `${other} should be refused`);
      }
    });
  });

  test("an explicit scheme is still honoured exactly", () => {
    withEnv("http://localhost:8080", () => {
      assert.equal(allow("http://localhost:8080"), "http://localhost:8080");
      assert.equal(resolveAllowedOrigin("https://localhost:8080"), null);
    });
  });

  test("junk input is refused rather than throwing", () => {
    withEnv("https://a.example.com", () => {
      for (const junk of ["", "javascript:alert(1)", "//evil.test", "ftp://a.example.com"]) {
        assert.equal(resolveAllowedOrigin(junk), null, `"${junk}" should be refused`);
      }
    });
  });
});

describe("state hashing", () => {
  test("the digest is a 64 character lowercase hex string", async () => {
    const h = await sha256Hex("abc");
    assert.match(h, /^[0-9a-f]{64}$/);
  });

  test("it matches the known SHA-256 of a known input", async () => {
    // Pinned against the published digest, so a change of algorithm or
    // encoding cannot pass unnoticed.
    assert.equal(
      await sha256Hex("abc"),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  test("distinct states produce distinct digests", async () => {
    assert.notEqual(await sha256Hex("state-a"), await sha256Hex("state-b"));
  });

  test("hashing is stable, so a lookup finds the row it wrote", async () => {
    assert.equal(await sha256Hex("state-a"), await sha256Hex("state-a"));
  });
});

describe("secret redaction", () => {
  const cases = [
    ["https://graph.facebook.com/me?access_token=EAAB123456789abcdef", "access_token in a URL"],
    ['{"refresh_token":"1//0gabcdefghijklmnop"}', "refresh_token in JSON"],
    ["Authorization: Bearer sk-abcdefghijklmnop", "a bearer header"],
    ["client_secret=abcdef1234567890", "a client secret"],
    ["EAAGm0PX4ZCpsBA1234567890abcdefghij", "a bare Meta token"],
    ['api_key: "sk-ant-abcdefghijklmnop"', "an api key"],
    ["https://flas.test/cb?code=4/0AeanS0abcdefghij&state=x", "an authorization code"],
    ["callback ...?state=abcdef0123456789abcdef0123456789 failed", "a state value"],
  ];

  for (const [input, label] of cases) {
    test(`strips ${label}`, () => {
      const out = redactSecrets(input) ?? "";
      assert.ok(out.includes("[redacted]"), `nothing was redacted in: ${out}`);
      // The specific secret substrings must be gone.
      for (const secret of ["EAAB123456789abcdef", "1//0gabcdefghijklmnop", "sk-abcdefghijklmnop", "abcdef1234567890", "EAAGm0PX4ZCpsBA1234567890abcdefghij", "sk-ant-abcdefghijklmnop", "4/0AeanS0abcdefghij", "abcdef0123456789abcdef0123456789"]) {
        if (input.includes(secret)) {
          assert.equal(out.includes(secret), false, `"${secret}" survived redaction: ${out}`);
        }
      }
    });
  }

  test("ordinary provider text is left readable", () => {
    const msg = "The Page you requested is not eligible for this feature.";
    assert.equal(redactSecrets(msg), msg);
  });

  test("null and undefined are handled", () => {
    assert.equal(redactSecrets(null), null);
    assert.equal(redactSecrets(undefined), null);
  });

  test("output is capped so a huge provider body cannot fill a log", () => {
    assert.ok((redactSecrets("x".repeat(10_000)) ?? "").length <= 2000);
  });
});
