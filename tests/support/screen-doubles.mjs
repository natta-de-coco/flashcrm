// Stand-ins for the modules a route screen reaches out to, so a test can render
// the real screen. scripts/build-screen-bundle.mjs points every stubbed module
// at this one file; each export below is whichever name the screen imports.
//
// The data client answers nothing until the test calls `releaseData()`. That is
// the point: a real screen renders once while its queries are loading and again
// when they finish, and that second render is where a hook placed after a
// "loading" early return makes React throw.
import * as React from "react";

/* ── data client ─────────────────────────────────────────────────────────── */

let tables = {};
let gate = deferred();

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Sets what each table returns and closes the gate again. */
export function resetData(rows = {}) {
  tables = rows;
  gate = deferred();
}

/** Lets every pending query answer. */
export function releaseData() {
  gate.resolve();
}

function query(table) {
  const chain = new Proxy(
    {},
    {
      get(_target, key) {
        if (key === "then") {
          return (onFulfilled, onRejected) =>
            gate.promise
              .then(() => ({ data: tables[table] ?? [], error: null, count: 0 }))
              .then(onFulfilled, onRejected);
        }
        // select / order / eq / limit / insert / update ... all keep chaining.
        return () => chain;
      },
    },
  );
  return chain;
}

export const supabase = {
  from: (table) => query(table),
  channel: () => {
    const channel = { on: () => channel, subscribe: () => channel };
    return channel;
  },
  removeChannel: () => undefined,
};

/* ── hooks and server functions ──────────────────────────────────────────── */

export function useTenant() {
  return { tenant: { currency: "USD" }, staffRole: "company_admin", loading: false };
}

export function useI18n() {
  const t = (key) => key;
  return { t, tr: t, tx: (_key, fallback) => fallback, language: "en", dir: "ltr" };
}

export function useServerFn(fn) {
  return fn;
}

export const recordAuditEvent = async () => undefined;

/* ── router ──────────────────────────────────────────────────────────────── */

/** createFileRoute("/path")({ component }) -> the options, so a test can read `.component`. */
export const createFileRoute = () => (options) => options;

/* ── a dialog the screen only opens on a click ───────────────────────────── */

export function ContactDetailDialog() {
  return React.createElement("div", { "data-testid": "contact-detail" });
}
