// Recovery from stale code-split chunks after a publish.
//
//   npm run test:stale-chunk
//
// MUTATION=no_guard removes the reload window. The suite MUST fail: a page
// that reloads every time a file is missing reloads forever.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("node_modules/.cache", { recursive: true });
buildSync({
  entryPoints: ["src/lib/stale-chunk.ts"],
  outfile: "node_modules/.cache/flas-stale-chunk.mjs",
  format: "esm",
  platform: "node",
  bundle: true,
  logLevel: "error",
});
const mod = await import("../node_modules/.cache/flas-stale-chunk.mjs");
const { isStaleChunkError, STALE_CHUNK_RELOAD_WINDOW_MS } = mod;

const MUTATION = process.env.MUTATION ?? "";
if (MUTATION === "no_guard") console.log("!! MUTATION: reload guard removed — the suite must FAIL");

const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};
const reloadWith = (now, storage) => {
  let reloads = 0;
  const started =
    MUTATION === "no_guard"
      ? (reloads++, true)
      : mod.reloadForStaleChunk(now, storage, () => reloads++);
  return { started, reloads };
};

describe("recognising a stale chunk", () => {
  test("the message production recorded", () => {
    assert.equal(
      isStaleChunkError(
        new TypeError(
          "Failed to fetch dynamically imported module: https://flas.mobidigisol.com/assets/route-abc123.js",
        ),
      ),
      true,
    );
  });

  test("Firefox, Safari and Vite's CSS preload wording", () => {
    assert.equal(
      isStaleChunkError(new Error("error loading dynamically imported module: /assets/x.js")),
      true,
    );
    assert.equal(isStaleChunkError(new TypeError("Importing a module script failed.")), true);
    assert.equal(isStaleChunkError(new Error("Unable to preload CSS for /assets/x.css")), true);
  });

  test("ordinary errors are not treated as stale chunks", () => {
    for (const e of [
      new TypeError("Failed to fetch"),
      new TypeError("Cannot read properties of undefined (reading 'toLowerCase')"),
      new Error("Script error."),
      null,
      undefined,
      {},
    ]) {
      assert.equal(isStaleChunkError(e), false, String(e?.message ?? e));
    }
  });
});

describe("reloading once, never in a loop", () => {
  test("the first stale chunk reloads the page", () => {
    const r = reloadWith(1_000_000, memoryStorage());
    assert.equal(r.started, true);
    assert.equal(r.reloads, 1);
  });

  test("a second failure within the window does not reload again", () => {
    const storage = memoryStorage();
    reloadWith(1_000_000, storage);
    const again = reloadWith(1_000_000 + 5_000, storage);
    assert.equal(again.started, false);
    assert.equal(again.reloads, 0);
  });

  test("after the window, a later publish can reload again", () => {
    const storage = memoryStorage();
    reloadWith(1_000_000, storage);
    const later = reloadWith(1_000_000 + STALE_CHUNK_RELOAD_WINDOW_MS + 1, storage);
    assert.equal(later.started, true);
  });

  test("without storage there is no guard, so it does not reload automatically", () => {
    if (MUTATION === "no_guard") return assert.fail("guard removed");
    assert.equal(
      mod.reloadForStaleChunk(1, null, () => assert.fail("reloaded")),
      false,
    );
  });

  test("storage that throws does not reload", () => {
    if (MUTATION === "no_guard") return assert.fail("guard removed");
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
    };
    assert.equal(
      mod.reloadForStaleChunk(1, broken, () => assert.fail("reloaded")),
      false,
    );
  });
});
