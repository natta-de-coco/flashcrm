-- Logos are public brand assets. Uploads run through the authenticated,
-- company-admin server handler; no browser write policy is granted.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('company-branding', 'company-branding', true, 2097152, ARRAY['image/png', 'image/jpeg'])
ON CONFLICT (id) DO NOTHING;
