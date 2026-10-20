import test from "node:test";
import assert from "node:assert/strict";
import { isSafeWordPressUrl, isSameCanonicalOrigin } from "../src/lib/seo-url.ts";

test("isSafeWordPressUrl blocks SSRF, private networks, cloud metadata, and invalid protocols", () => {
  // Loopback and internal hosts
  assert.equal(isSafeWordPressUrl("http://localhost"), false);
  assert.equal(isSafeWordPressUrl("https://localhost:8080"), false);
  assert.equal(isSafeWordPressUrl("http://app.local"), false);
  assert.equal(isSafeWordPressUrl("http://service.internal"), false);
  assert.equal(isSafeWordPressUrl("http://router.lan"), false);

  // Cloud metadata
  assert.equal(isSafeWordPressUrl("http://169.254.169.254/latest/meta-data"), false);
  assert.equal(isSafeWordPressUrl("http://metadata.google.internal/computeMetadata/v1/"), false);

  // RFC1918 private IPv4
  assert.equal(isSafeWordPressUrl("http://127.0.0.1/wp-json"), false);
  assert.equal(isSafeWordPressUrl("http://10.0.0.5:8000"), false);
  assert.equal(isSafeWordPressUrl("http://172.16.0.1"), false);
  assert.equal(isSafeWordPressUrl("http://172.31.255.255"), false);
  assert.equal(isSafeWordPressUrl("http://192.168.1.1/wp-admin"), false);

  // Pure decimal / integer IP bypass attempts
  assert.equal(isSafeWordPressUrl("http://2130706433/"), false); // 127.0.0.1 as dword

  // IPv6 loopback, unspecified, and private
  assert.equal(isSafeWordPressUrl("http://[::1]/"), false);
  assert.equal(isSafeWordPressUrl("http://[::]/"), false);
  assert.equal(isSafeWordPressUrl("http://[0:0:0:0:0:0:0:1]/"), false);
  assert.equal(isSafeWordPressUrl("http://[fe80::1]/"), false);
  assert.equal(isSafeWordPressUrl("http://[fc00::1]/"), false);

  // IPv4-mapped and IPv4-compatible IPv6
  assert.equal(isSafeWordPressUrl("http://[::ffff:127.0.0.1]/"), false);
  assert.equal(isSafeWordPressUrl("http://[::ffff:7f00:1]/"), false);
  assert.equal(isSafeWordPressUrl("http://[::127.0.0.1]/"), false);
  assert.equal(isSafeWordPressUrl("http://[::ffff:192.168.1.1]/"), false);

  // Protocol restrictions
  assert.equal(isSafeWordPressUrl("file:///etc/passwd"), false);
  assert.equal(isSafeWordPressUrl("ftp://example.com"), false);
  assert.equal(isSafeWordPressUrl("javascript:alert(1)"), false);
  assert.equal(isSafeWordPressUrl("gopher://127.0.0.1:70"), false);

  // Valid external WordPress addresses
  assert.equal(isSafeWordPressUrl("https://example.com"), true);
  assert.equal(isSafeWordPressUrl("https://www.myblog.com/"), true);
  assert.equal(isSafeWordPressUrl("https://blog.agency.ae/cms"), true);
});

test("isSameCanonicalOrigin only permits strictly HTTPS and same-canonical-host redirects", () => {
  const orig = "https://example.com/wp-json/wp/v2/posts";

  // Exact same host over HTTPS: ALLOWED
  assert.equal(isSameCanonicalOrigin("https://example.com/wp-json/wp/v2/posts/", orig), true);

  // Canonical apex <-> www over HTTPS: ALLOWED
  assert.equal(isSameCanonicalOrigin("https://www.example.com/wp-json/wp/v2/posts", orig), true);
  assert.equal(
    isSameCanonicalOrigin("https://example.com/wp-json/wp/v2/posts", "https://www.example.com/"),
    true,
  );

  // Plaintext HTTP downgrade: FORBIDDEN
  assert.equal(isSameCanonicalOrigin("http://example.com/wp-json/wp/v2/posts", orig), false);
  assert.equal(isSameCanonicalOrigin("http://www.example.com/wp-json/wp/v2/posts", orig), false);

  // Different port: FORBIDDEN
  assert.equal(isSameCanonicalOrigin("https://example.com:8443/wp-json", orig), false);

  // External / Attacker origin redirect: FORBIDDEN (P1 vulnerability prevention)
  assert.equal(isSameCanonicalOrigin("https://attacker.com/wp-json/wp/v2/posts", orig), false);
  assert.equal(isSameCanonicalOrigin("https://evil.org/steal", orig), false);
  assert.equal(isSameCanonicalOrigin("https://example.com.attacker.com/", orig), false);
  assert.equal(isSameCanonicalOrigin("https://subdomain.example.com/", orig), false);
});
