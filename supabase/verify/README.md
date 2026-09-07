# Verifying migrations before you paste them

These migrations change RLS on a live database holding real customer data. This
harness applies the whole history to a throwaway PostgreSQL 17 instance first,
so a mistake surfaces here instead of half-way through your SQL Editor paste.

It found two real ones. `20260830010000` referenced an `oauth_states.redirect_to`
column that never existed in any version of the schema; because that file is a
single transaction, the entire migration rolled back — including
`consume_oauth_state()`, which the OAuth callback calls to finish connecting a
social account. Nothing in the app surfaced this. It just failed at the last
step, every time. The second was ordering: a view counting `messages.tenant_id`
was defined before the migration that adds that column.

## Run it

No Docker and no Postgres install — the binaries come from npm. The exact
version matters: every embedded-postgres release carries a `-beta` suffix, so
a plain `@17` range matches nothing.

```bash
npm install --no-save embedded-postgres@17.10.0-beta.17 pg
node supabase/verify/verify-migrations.mjs
```

Two passes:

- **Pass 1** applies every migration in order to an empty database. Everything
  must apply clean. A failure here is a failure you would have hit live.
- **Pass 2** applies them all again on top of themselves. Only the *pending*
  files need to pass — the 2026-08-2x Lovable baseline is not idempotent and
  never gets re-run, since Supabase tracks what it has applied. Pass 2 exists
  so that if your paste dies part-way you can fix the cause and paste again.

## What the shim is

`supabase-shim.sql` stands in for what a real Supabase project provides before
any migration runs: the `anon` / `authenticated` / `service_role` roles, the
`auth` schema with `auth.users` and `auth.uid()`, `extensions` with pgcrypto,
the `supabase_realtime` publication, and a `vault` stub. It is scaffolding for
the test only and is never applied to your project.

Two things must match real Supabase or you get false failures: the database has
to be **UTF8** (the Windows default, WIN1252, rejects the box-drawing characters
in the migration comments), and **`extensions` must be on the search_path** (the
migrations call `gen_random_bytes()` unqualified in column defaults).

## verify-oauth-roundtrip.mjs

`verify-migrations.mjs` proves the DDL applies. It does not prove the resulting
schema is *correct*, because PostgreSQL does not resolve table or column
references inside a plpgsql body at `CREATE` time — only syntax. A function
referencing a column that does not exist is created without complaint and fails
the first time a real user triggers it. That is why the harness also smoke-calls
every function the app depends on.

`verify-oauth-roundtrip.mjs` goes one step further for the flow that was
actually broken: it inserts a state row the way `oauth.server.ts` does, consumes
it at the callback, then checks that a replay and an expired state are both
rejected.

```bash
node supabase/verify/verify-oauth-roundtrip.mjs
```

Both scripts exit non-zero on failure, so they can gate a deploy.
