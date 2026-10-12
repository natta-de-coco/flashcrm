-- Minimal stand-in for what a real Supabase project provides before any
-- migration runs. Everything here is scaffolding, not part of the app.
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD 'x';
CREATE ROLE supabase_admin NOLOGIN NOINHERIT;
GRANT anon, authenticated, service_role TO authenticator;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Supabase reads the verified JWT out of a GUC. Same contract here so the
-- policies compile and can be exercised by setting request.jwt.claims.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

-- Realtime publication the first migration adds tables to.
CREATE PUBLICATION supabase_realtime;

-- Vault stub: one migration reads decrypted_secrets.
CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, secret text);
CREATE VIEW vault.decrypted_secrets AS SELECT id, name, secret AS decrypted_secret FROM vault.secrets;

-- Supabase Storage. Lovable's migrations set policies on storage.objects for
-- the invoices bucket, so the harness needs the same shape to validate them.
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  metadata jsonb
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
-- storage.foldername() splits an object path; policies use it to scope by tenant.
CREATE OR REPLACE FUNCTION storage.foldername(name text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT string_to_array(regexp_replace(name, '/[^/]*$', ''), '/');
$$;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;

GRANT USAGE ON SCHEMA public, extensions, auth TO anon, authenticated, service_role;
