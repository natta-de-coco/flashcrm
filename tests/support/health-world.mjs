// The world the integration-health tests run in: a database double, a recorder in place of the
// network, and the signed-in sessions of two companies. Nothing here can reach a real platform,
// the live site or a real database; every token is an invented string.
//
// The code under test is the real bundle (scripts/build-health-bundle.mjs). It reads
// globalThis.healthTest for its four doubles: the database, the audit log, the token refresh call
// and the "unable to decrypt" switch.
import { createDb } from "./db-double.mjs";
import { missingScopesFor } from "../../node_modules/.cache/flas-connection-state.mjs";

/** Every scope the connector needs: what is missing when nothing useful was granted. */
export const requiredScopesFor = (platform) => missingScopesFor(platform, ["__nothing_useful__"]);

export const A = "aaaaaaaa-0000-0000-0000-000000000001";
export const B = "bbbbbbbb-0000-0000-0000-000000000001";
export const ADMIN_A = "11111111-0000-0000-0000-00000000000a";
export const MEMBER_A = "11111111-0000-0000-0000-00000000000b";
export const ADMIN_B = "22222222-0000-0000-0000-00000000000a";

export const GRAPH = "https://graph.facebook.com/v21.0";
export const EVIDENCE = ["last_validation_attempt_at", "last_validation_success_at"];

/** Invented secrets, shaped like the real ones so the redaction patterns have something to catch. */
export const SECRET = {
  meta: "EAABwzLixnjYBO1234567890abcdefghijklmnop",
  metaNew: "EAABwzLixnjYBNEW987654321zyxwvutsrqponmlk",
  googleRefresh: "1//0gRefreshTokenValueABCDEFGHIJKLMNOP",
  googleAccess: "ya29.a0AfH6SMBaccessTokenValueABCDEFGHIJKL",
};

let ids = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;

export const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
export const HOUR = 3600_000;
export const DAY = 24 * HOUR;

/** A JSON answer from a pretend platform. */
export const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

/** What a token refresh answers unless a test says otherwise: a new access token, same refresh token. */
const defaultRefresh = async (args) => ({
  token: SECRET.metaNew,
  refreshToken: args.refreshToken,
  expiresAt: iso(HOUR),
  scopes: [],
});

export function createWorld() {
  const db = createDb();
  const world = {
    db,
    audits: [],
    /** Every request the code made to a "platform": { url, method, headers, body, signal }. */
    fetches: [],
    refreshCalls: [],
    /** Replace to change what a token refresh answers (or throws); reset() puts it back. */
    refreshImpl: defaultRefresh,
    /** Everything written to the console while capture() is on. */
    consoleLines: [],
  };

  // The database as the code sees it: the select list is remembered (so a fault can depend on it)
  // and honoured (so code cannot lean on a column it did not ask for, as in PostgREST).
  const project = (row, columns) => {
    if (!row || typeof row !== "object" || !columns || columns.trim() === "*") return row;
    const wanted = columns.split(",").map((c) => c.trim());
    return Object.fromEntries(wanted.filter((c) => c in row).map((c) => [c, row[c]]));
  };
  const wrapped = {
    rpc: (name, args) => db.client.rpc(name, args),
    from(table) {
      const q = db.client.from(table);
      const select = q.select.bind(q);
      q.select = (columns, options) => {
        q.columns = columns;
        return select(columns, options);
      };
      const then = q.then.bind(q);
      q.then = (resolve, reject) =>
        then((result) => {
          let out = result;
          if (q.columns && result?.data) {
            out = {
              ...result,
              data: Array.isArray(result.data)
                ? result.data.map((r) => project(r, q.columns))
                : project(result.data, q.columns),
            };
          }
          return resolve ? resolve(out) : out;
        }, reject);
      return q;
    },
  };

  globalThis.healthTest = {
    db: wrapped,
    audits: world.audits,
    openFails: false,
    refresh: async (args) => {
      world.refreshCalls.push(args);
      return await world.refreshImpl(args);
    },
  };

  world.reset = (rows = {}) => {
    db.reset({
      organizations: [
        { id: A, name: "Alpha Co" },
        { id: B, name: "Beta Co" },
      ],
      profiles: [
        { id: ADMIN_A, tenant_id: A, staff_role: "company_admin" },
        { id: MEMBER_A, tenant_id: A, staff_role: "agent" },
        { id: ADMIN_B, tenant_id: B, staff_role: "company_admin" },
      ],
      ...rows,
    });
    world.audits.length = 0;
    world.fetches.length = 0;
    world.refreshCalls.length = 0;
    world.refreshImpl = defaultRefresh;
    world.consoleLines.length = 0;
    globalThis.healthTest.openFails = false;
    // The lease: granted unless a test says otherwise.
    db.onRpc("try_lock_connection_refresh", async () => ({ data: true, error: null }));
    db.onRpc("release_connection_refresh", async () => ({ data: null, error: null }));
    delete world.restoreFetch;
  };

  /** A signed-in caller of a company, the way the server functions receive one. */
  world.session = (tenantId, userId) => ({
    userId,
    supabase: {
      rpc: wrapped.rpc,
      from(table) {
        const q = wrapped.from(table);
        // Row-level security: a signed-in browser session sees only its own company's rows.
        if (
          ["social_accounts", "social_account_scans", "wa_numbers", "lead_sites"].includes(table)
        ) {
          q.eq("tenant_id", tenantId);
        }
        return q;
      },
    },
  });
  world.admin = () => world.session(A, ADMIN_A);
  world.member = () => world.session(A, MEMBER_A);

  /**
   * An account row, with a token that works and every permission the connector needs. Override
   * anything. Inserted into the database unless `{ insert: false }`.
   */
  world.account = (over = {}, { insert = true } = {}) => {
    const platform = over.platform ?? "facebook";
    const row = {
      id: uuid(),
      tenant_id: A,
      platform,
      label: `${platform} account`,
      active: true,
      access_token: `sealed:${SECRET.meta}`,
      refresh_token: null,
      token_expires_at: null,
      granted_scopes: requiredScopesFor(platform),
      last_synced_at: iso(-HOUR),
      last_analytics_sync_at: null,
      last_error: null,
      last_error_at: null,
      status_reason: null,
      retry_count: 0,
      last_retry_at: null,
      next_retry_at: null,
      external_id: "1000",
      connect_method: "oauth",
      connection_state: "connected",
      created_at: iso(-DAY + ids * 1000),
      last_validation_attempt_at: null,
      last_validation_success_at: null,
      ...over,
    };
    if (insert) db.table("social_accounts").push(row);
    return row;
  };
  world.stored = (id) => db.table("social_accounts").find((r) => r.id === id);
  world.logRows = () => db.table("connection_retry_log");

  /**
   * Puts the network in place of the real one. `routes` are tried in order; the first whose
   * `match(url, init)` is true answers. A request nobody planned for throws, so the test fails
   * rather than the code quietly reaching somewhere.
   */
  world.provider = (routes) => {
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      world.fetches.push({
        url: String(url),
        method: init.method ?? "GET",
        headers: init.headers ?? {},
        body: init.body ?? null,
        signal: init.signal ?? null,
      });
      const route = routes.find((r) => r.match(String(url), init));
      if (!route) throw new Error(`unplanned request to ${url}`);
      return typeof route.reply === "function" ? await route.reply(String(url), init) : route.reply;
    };
    world.restoreFetch = () => {
      globalThis.fetch = real;
    };
  };
  world.restore = () => {
    world.restoreFetch?.();
    delete world.restoreFetch;
  };

  /** Records console output (all levels) until the returned function is called. */
  world.capture = () => {
    const levels = ["log", "info", "warn", "error", "debug"];
    const saved = Object.fromEntries(levels.map((l) => [l, console[l]]));
    for (const l of levels) {
      console[l] = (...args) => {
        world.consoleLines.push(
          args.map((a) => (typeof a === "string" ? a : safeJson(a))).join(" "),
        );
      };
    }
    return () => {
      for (const l of levels) console[l] = saved[l];
    };
  };

  world.reset();
  return world;
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** A route for a URL starting with `prefix`. */
export const on = (prefix, reply) => ({
  match: (url) => url.startsWith(prefix),
  reply,
});

/** What Facebook answers for a healthy Page token: the Page itself, and its permissions. */
export function facebookHealthy({ id = "1000", scopes = requiredScopesFor("facebook") } = {}) {
  return [
    on(`${GRAPH}/${id}?fields=id`, () => json(200, { id })),
    on(`${GRAPH}/me/permissions`, () =>
      json(200, { data: scopes.map((permission) => ({ permission, status: "granted" })) }),
    ),
  ];
}

/** Everything that was ever stored or returned, as one searchable string. */
export const everything = (world, result) =>
  JSON.stringify({
    rows: world.db.state.rows,
    audits: world.audits,
    console: world.consoleLines,
    fetchUrls: world.fetches.map((f) => f.url),
    result,
  });

/** A write fault: the evidence columns do not exist in this database. */
export function withoutEvidenceColumns(world) {
  world.db.fail("social_accounts:update", (q) => {
    const patch = q.patch ?? {};
    return EVIDENCE.some((c) => c in patch)
      ? {
          code: "PGRST204",
          message: `Could not find the '${EVIDENCE.find((c) => c in patch)}' column of 'social_accounts' in the schema cache`,
        }
      : undefined;
  });
  world.db.fail("social_accounts:read", (q) =>
    EVIDENCE.some((c) => String(q.columns ?? "").includes(c))
      ? {
          code: "42703",
          message: "column social_accounts.last_validation_success_at does not exist",
        }
      : undefined,
  );
}
