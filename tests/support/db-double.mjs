// A small stand-in for the Supabase service-role client, good enough to drive
// the real server code: filters, single-row reads, counts, inserts, updates and
// upserts against plain arrays. Tests own the rows and can make any table or
// operation fail, which is how the "what happens when the database refuses"
// paths get exercised.
//
// Shared by the public-endpoint suites so they describe the same database.

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The unique keys the real schema has on tables that the code under test upserts into (see
// supabase/migrations). Every database starts with them, so an upsert that names any other column
// list fails here as it would in Postgres, and so does a second row for the same key.
const schemaKeys = () => ({ leads: [["tenant_id", "email"]] });

export function createDb() {
  const state = {
    rows: {},
    faults: {},
    rpcResults: {},
    rpcHandlers: {},
    rpcCalls: [],
    uniques: schemaKeys(),
    ids: 0,
    // PostgREST answers a read with at most this many rows (1,000 by default) and says nothing
    // when it stops there. null = no cap. Set it small to put a result beyond it.
    rowCap: null,
  };

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.mode = "read";
    }
    select(_columns, options) {
      if (options?.count) this.counting = true;
      return this;
    }
    eq(key, value) {
      this.filters.push((r) => r[key] === value);
      return this;
    }
    neq(key, value) {
      this.filters.push((r) => r[key] !== value);
      return this;
    }
    in(key, values) {
      this.filters.push((r) => values.includes(r[key]));
      return this;
    }
    ilike(key, pattern) {
      // As in Postgres: case-insensitive, % is any run of characters, _ is any one
      // character, and a backslash makes the next character an ordinary one.
      let source = "";
      for (let i = 0; i < pattern.length; i++) {
        const c = pattern[i];
        if (c === "\\" && i + 1 < pattern.length) source += escapeRegExp(pattern[++i]);
        else if (c === "%") source += "[\\s\\S]*";
        else if (c === "_") source += "[\\s\\S]";
        else source += escapeRegExp(c);
      }
      const matcher = new RegExp(`^${source}$`, "i");
      this.filters.push((r) => typeof r[key] === "string" && matcher.test(r[key]));
      return this;
    }
    is(key, value) {
      // Only IS NULL is used by the code under test.
      if (value === null) this.filters.push((r) => r[key] == null);
      return this;
    }
    gt(key, value) {
      // Compared the way `order` sorts, so "after this id" and "ordered by id" agree.
      this.filters.push((r) => String(r[key] ?? "").localeCompare(String(value)) > 0);
      return this;
    }
    gte(key, value) {
      this.filters.push((r) => String(r[key] ?? "") >= value);
      return this;
    }
    not(key, operator, value) {
      if (operator === "is" && value === null) this.filters.push((r) => r[key] != null);
      return this;
    }
    order(column, options = {}) {
      // Really sorts: code that says "the oldest row wins" has to be tested
      // against an order, not against insertion sequence.
      this.sort = { column, ascending: options.ascending !== false };
      return this;
    }
    limit(n) {
      this.take = n;
      return this;
    }
    range(from, to) {
      this.offset = from;
      this.take = to - from + 1;
      return this;
    }
    maybeSingle() {
      this.one = true;
      return this;
    }
    single() {
      this.one = true;
      this.required = true;
      return this;
    }
    insert(payload) {
      this.mode = "insert";
      this.payload = payload;
      return this;
    }
    update(patch) {
      this.mode = "update";
      this.patch = patch;
      return this;
    }
    delete() {
      this.mode = "delete";
      return this;
    }
    upsert(payload, { onConflict } = {}) {
      this.mode = "upsert";
      this.payload = payload;
      this.conflict = (onConflict ?? "id").split(",").map((k) => k.trim());
      return this;
    }
    row(payload) {
      // The database fills these in; code under test may read them back.
      return {
        id: `${this.table}-${++state.ids}`,
        created_at: new Date().toISOString(),
        ...payload,
      };
    }
    then(resolve, reject) {
      // A fault can be a function of the query, to refuse some statements on
      // a table and not others (one write of several, one column of many).
      const declared = state.faults[`${this.table}:${this.mode}`];
      const fault = typeof declared === "function" ? declared(this) : declared;
      if (fault?.empty) {
        // "Nothing there yet": what a read sees a moment before another
        // request's row is committed. Lets a race be staged in order.
        return Promise.resolve({
          data: this.one ? null : [],
          error: null,
          count: this.counting ? 0 : null,
        }).then(resolve, reject);
      }
      if (fault) {
        const error = typeof fault === "string" ? { message: fault } : fault;
        return Promise.resolve({ data: null, error, count: null }).then(resolve, reject);
      }
      const table = (state.rows[this.table] ??= []);
      let found = table.filter((r) => this.filters.every((f) => f(r)));
      if (this.mode === "update") for (const r of found) Object.assign(r, this.patch);
      if (this.mode === "delete") {
        for (const r of found) table.splice(table.indexOf(r), 1);
      }
      if (this.mode === "insert") {
        // A table can declare the unique key the real schema has, because code
        // that relies on a unique violation (23505) to stay correct under
        // concurrency has to be tested against one.
        const uniques = state.uniques[this.table] ?? [];
        const incoming = Array.isArray(this.payload) ? this.payload : [this.payload];
        if (uniques.length > 0) {
          // As in Postgres, a key with a NULL in it never collides.
          const clash = incoming.find((p) =>
            uniques.some(
              (unique) =>
                unique.every((k) => p[k] != null) &&
                table.some((r) => unique.every((k) => r[k] === p[k])),
            ),
          );
          if (clash) {
            return Promise.resolve({
              data: null,
              error: { code: "23505", message: "duplicate key value violates unique constraint" },
              count: null,
            }).then(resolve, reject);
          }
        }
        const rows = incoming.map((p) => this.row(p));
        table.push(...rows);
        found = rows;
      }
      if (this.mode === "upsert") {
        // Postgres only accepts ON CONFLICT (columns) when a unique index is on exactly those
        // columns; with the primary key (id) as the default. Anything else is error 42P10, so a
        // test that declares the real unique keys (db.unique) sees the mistake the real database
        // would make.
        const wanted = [...this.conflict].sort().join(",");
        const known = [["id"], ...(state.uniques[this.table] ?? [])].map((u) =>
          [...u].sort().join(","),
        );
        if (!known.includes(wanted)) {
          return Promise.resolve({
            data: null,
            error: {
              code: "42P10",
              message:
                "there is no unique or exclusion constraint matching the ON CONFLICT specification",
            },
            count: null,
          }).then(resolve, reject);
        }
        const existing = table.find((r) => this.conflict.every((k) => r[k] === this.payload[k]));
        if (existing) Object.assign(existing, this.payload);
        else table.push(this.row(this.payload));
        found = [existing ?? table.at(-1)];
      }
      if (this.sort) {
        const { column, ascending } = this.sort;
        found = [...found].sort((a, b) => {
          const left = String(a[column] ?? "");
          const right = String(b[column] ?? "");
          return ascending ? left.localeCompare(right) : right.localeCompare(left);
        });
      }
      if (this.mode === "read") {
        const start = this.offset ?? 0;
        let size = this.take ?? Infinity;
        if (state.rowCap) size = Math.min(size, state.rowCap);
        if (this.take || state.rowCap || start) found = found.slice(start, start + size);
      } else if (this.take) found = found.slice(0, this.take);
      // PostgREST's single-row reads are not "the first row": asking for one
      // row and getting several is an error, and code that ignores that error
      // silently stops doing whatever it asked the row for.
      let error = null;
      if (this.one && found.length > 1) {
        error = {
          code: "PGRST116",
          message: "JSON object requested, multiple (or no) rows returned",
        };
      } else if (this.required && !found[0]) {
        error = { message: "no rows returned" };
      }
      return Promise.resolve({
        data: error ? null : this.one ? (found[0] ?? null) : found,
        error,
        count: this.counting ? found.length : null,
      }).then(resolve, reject);
    }
  }

  return {
    state,
    client: {
      from: (table) => new Query(table),
      rpc: async (name, args) => {
        state.rpcCalls.push({ name, args });
        // A handler answers like the function would ({ data, error }), or throws like a dropped
        // connection. Without one, the call succeeds with whatever rpcResults holds.
        const handler = state.rpcHandlers[name];
        if (handler) return handler(args);
        return { data: state.rpcResults[name] ?? null, error: null };
      },
    },
    /** Replaces every table's rows; anything not named starts empty. */
    reset(rows = {}) {
      state.rows = rows;
      state.uniques = schemaKeys();
      state.faults = {};
      state.rpcResults = {};
      state.rpcHandlers = {};
      state.rpcCalls = [];
      state.ids = 0;
      state.rowCap = null;
    },
    table(name) {
      return (state.rows[name] ??= []);
    },
    fail(key, error) {
      state.faults[key] = error;
    },
    /**
     * Declares a unique key on a table, so a second identical insert fails as
     * 23505. A table can have several (a primary key and a unique index).
     */
    unique(table, columns) {
      (state.uniques[table] ??= []).push(columns);
    },
    /** Makes a database function answer with `handler(args)` -> { data, error }. */
    onRpc(name, handler) {
      state.rpcHandlers[name] = handler;
    },
    /** Lifts a fault set with fail(): the database has recovered. */
    recover(key) {
      delete state.faults[key];
    },
  };
}

/** A timestamp this many seconds in the past, for seeding rows inside a window. */
export const secondsAgo = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();
