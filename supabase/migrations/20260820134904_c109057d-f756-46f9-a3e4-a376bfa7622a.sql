CREATE TYPE public.app_role AS ENUM ('admin','agent');
CREATE TYPE public.conv_channel AS ENUM ('whatsapp','web');
CREATE TYPE public.conv_status AS ENUM ('open','pending','closed');
CREATE TYPE public.msg_direction AS ENUM ('inbound','outbound');
CREATE TYPE public.msg_sender AS ENUM ('contact','agent','bot');
CREATE TYPE public.lead_stage AS ENUM ('new','qualified','proposal','negotiation','won','lost');

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY,
  full_name TEXT,
  email TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_read_all" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_insert_self" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_update_self" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE TRIGGER profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE POLICY "roles_read_all" ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "roles_admin_write" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE first_user BOOLEAN;
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'), NEW.email)
  ON CONFLICT (id) DO NOTHING;
  SELECT COUNT(*) = 0 INTO first_user FROM public.user_roles;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, CASE WHEN first_user THEN 'admin'::public.app_role ELSE 'agent'::public.app_role END)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TABLE public.contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'Unknown',
  phone TEXT UNIQUE,
  email TEXT,
  company TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  stage public.lead_stage NOT NULL DEFAULT 'new',
  value NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  owner_id UUID,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
GRANT ALL ON public.contacts TO service_role;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contacts_team_all" ON public.contacts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER contacts_updated BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  channel public.conv_channel NOT NULL DEFAULT 'whatsapp',
  status public.conv_status NOT NULL DEFAULT 'open',
  assigned_to UUID,
  bot_enabled BOOLEAN NOT NULL DEFAULT true,
  unread_count INTEGER NOT NULL DEFAULT 0,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_preview TEXT,
  web_session_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX conversations_last_msg_idx ON public.conversations (last_message_at DESC);
CREATE UNIQUE INDEX conversations_web_session_idx ON public.conversations (web_session_id) WHERE web_session_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conversations_team_all" ON public.conversations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER conversations_updated BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  direction public.msg_direction NOT NULL,
  sender public.msg_sender NOT NULL,
  sender_id UUID,
  body TEXT NOT NULL DEFAULT '',
  media_url TEXT,
  wa_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX messages_conv_idx ON public.messages (conversation_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "messages_team_all" ON public.messages FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.bot_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true,
  enabled BOOLEAN NOT NULL DEFAULT true,
  bot_name TEXT NOT NULL DEFAULT 'Flas Assistant',
  greeting TEXT NOT NULL DEFAULT 'Hi! Thanks for reaching out. How can I help you today?',
  instructions TEXT NOT NULL DEFAULT 'You are a helpful WhatsApp support assistant. Be concise, friendly and professional. Answer in the customer''s language.',
  model TEXT NOT NULL DEFAULT 'google/gemini-3.7-flash',
  handoff_keywords TEXT[] NOT NULL DEFAULT ARRAY['human','agent','representative','complaint'],
  business_hours_only BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bot_settings_singleton CHECK (id)
);
GRANT SELECT ON public.bot_settings TO authenticated;
GRANT UPDATE, INSERT ON public.bot_settings TO authenticated;
GRANT ALL ON public.bot_settings TO service_role;
ALTER TABLE public.bot_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bot_read" ON public.bot_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "bot_admin_update" ON public.bot_settings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "bot_admin_insert" ON public.bot_settings FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
INSERT INTO public.bot_settings (id) VALUES (true);

CREATE TABLE public.wa_config (
  id BOOLEAN PRIMARY KEY DEFAULT true,
  display_phone TEXT,
  business_name TEXT,
  phone_number_id TEXT,
  webhook_verified BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT wa_config_singleton CHECK (id)
);
GRANT SELECT, INSERT, UPDATE ON public.wa_config TO authenticated;
GRANT ALL ON public.wa_config TO service_role;
ALTER TABLE public.wa_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa_read" ON public.wa_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "wa_admin_update" ON public.wa_config FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "wa_admin_insert" ON public.wa_config FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
INSERT INTO public.wa_config (id) VALUES (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.conversations REPLICA IDENTITY FULL;