// The three things PostgREST does to a read that db-double.mjs does not, laid
// over it so the same rows, faults and tables are used:
//
//   * a request returns at most the project's row cap, however large a
//     `.limit()` asks for. On a default Supabase project that cap is 1,000, and
//     nothing in the response says rows were left behind;
//   * `.range(from, to)` returns that window, and `{ count: "exact" }` reports
//     every row the query matches, not the rows in the window;
//   * only the columns named in `.select()` come back, and `{ head: true }`
//     returns the count with no rows at all.
//
// Code that counts people has to be right under all three, so a suite that
// counts people reads through this rather than through the bare double. The
// second and third are how PostgREST is specified; the first is a project
// setting, modelled at Supabase's default.

/** Supabase's default "Max rows" API setting. */
export const SERVER_MAX_ROWS = 1000;

function project(row, columns) {
  if (!columns || columns.trim() === "*") return { ...row };
  const picked = {};
  for (const name of columns.split(",").map((column) => column.trim())) {
    if (name) picked[name] = row[name] ?? null;
  }
  return picked;
}

/**
 * Wraps a db-double so reads behave as PostgREST's do. `reads` collects one
 * entry per list request, for tests that need to know what was asked for.
 */
export function asPostgrest(db, { maxRows = SERVER_MAX_ROWS } = {}) {
  const reads = [];
  const client = {
    rpc: (...args) => db.client.rpc(...args),
    from(table) {
      const query = db.client.from(table);
      let columns = "*";
      let head = false;
      let window = null;
      let limit = null;

      const select = query.select.bind(query);
      query.select = (wanted, options) => {
        // After an insert or update, `.select()` only asks for the row back.
        if (query.mode === "read") {
          columns = wanted ?? "*";
          head = options?.head === true;
        }
        return select(wanted, options);
      };
      query.range = (from, to) => {
        window = [from, to];
        return query;
      };
      query.limit = (n) => {
        limit = n;
        return query;
      };

      const run = query.then.bind(query);
      query.then = (resolve, reject) => {
        if (query.mode !== "read" || query.one) {
          // Writes and single-row reads are the bare double's business.
          if (limit != null) query.take = limit;
          return run(resolve, reject);
        }
        return run((result) => {
          // A fault: there are no rows to window.
          if (!Array.isArray(result.data)) return result;
          const matched = result.data;
          const from = window ? window[0] : 0;
          const asked = window ? window[1] - window[0] + 1 : (limit ?? matched.length);
          const page = matched.slice(from, from + Math.min(asked, maxRows));
          reads.push({ table, columns, head, window, limit, returned: head ? 0 : page.length });
          return {
            ...result,
            data: head ? null : page.map((row) => project(row, columns)),
            count: query.counting ? matched.length : null,
          };
        }).then(resolve, reject);
      };
      return query;
    },
  };
  return { client, reads };
}
