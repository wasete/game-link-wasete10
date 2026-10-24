-- GameLink: repair private chat with the site owner/mediator.
-- Run this in Supabase SQL Editor as project owner. It is safe to rerun.

CREATE TABLE IF NOT EXISTS public.direct_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_b uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT direct_conversations_distinct_users CHECK (user_a <> user_b),
  CONSTRAINT direct_conversations_unique_pair UNIQUE (user_a, user_b)
);

CREATE TABLE IF NOT EXISTS public.direct_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES public.direct_conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  username text NOT NULL,
  content text NOT NULL DEFAULT '',
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT direct_messages_content_length CHECK (char_length(content) BETWEEN 0 AND 1000)
);

ALTER TABLE public.direct_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_messages ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE public.direct_messages ALTER COLUMN content SET DEFAULT '';
ALTER TABLE public.direct_messages DROP CONSTRAINT IF EXISTS direct_messages_content_check;
ALTER TABLE public.direct_messages DROP CONSTRAINT IF EXISTS direct_messages_content_length;
ALTER TABLE public.direct_messages ADD CONSTRAINT direct_messages_content_length CHECK (char_length(content) BETWEEN 0 AND 1000);

DROP POLICY IF EXISTS "participants read direct conversations" ON public.direct_conversations;
DROP POLICY IF EXISTS "participants read direct messages" ON public.direct_messages;
DROP POLICY IF EXISTS "participants send direct messages" ON public.direct_messages;
DROP POLICY IF EXISTS "participants update own direct messages" ON public.direct_messages;
DROP POLICY IF EXISTS "participants delete own direct messages" ON public.direct_messages;
CREATE POLICY "participants read direct conversations" ON public.direct_conversations
  FOR SELECT TO authenticated USING (auth.uid() = user_a OR auth.uid() = user_b);
CREATE POLICY "participants read direct messages" ON public.direct_messages
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.direct_conversations c
      WHERE c.id = conversation_id AND auth.uid() IN (c.user_a, c.user_b))
  );
CREATE POLICY "participants send direct messages" ON public.direct_messages
  FOR INSERT TO authenticated WITH CHECK (
    sender_id = auth.uid() AND public.is_active_member() AND
    EXISTS (SELECT 1 FROM public.direct_conversations c
      WHERE c.id = conversation_id AND auth.uid() IN (c.user_a, c.user_b))
  );

GRANT SELECT ON public.direct_conversations TO authenticated;
GRANT SELECT, INSERT ON public.direct_messages TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.direct_messages_id_seq TO authenticated;

CREATE OR REPLACE FUNCTION public.open_owner_conversation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  me uuid := auth.uid();
  owner_id uuid;
  convo public.direct_conversations%rowtype;
  a uuid;
  b uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF NOT public.is_active_member() THEN RAISE EXCEPTION 'Account is not active'; END IF;

  SELECT u.id INTO owner_id
  FROM auth.users u
  WHERE lower(coalesce(u.email, '')) = 'amirfoolmm@gmail.com'
  LIMIT 1;

  IF owner_id IS NULL THEN RAISE EXCEPTION 'Site owner account has not registered yet'; END IF;
  IF owner_id = me THEN RAISE EXCEPTION 'You are the site owner'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = owner_id AND p.banned = false) THEN
    RAISE EXCEPTION 'Owner profile is unavailable';
  END IF;

  IF me::text < owner_id::text THEN a := me; b := owner_id;
  ELSE a := owner_id; b := me; END IF;

  INSERT INTO public.direct_conversations(user_a, user_b)
  VALUES (a, b) ON CONFLICT (user_a, user_b) DO NOTHING;

  SELECT * INTO convo FROM public.direct_conversations WHERE user_a = a AND user_b = b;
  IF convo.id IS NULL THEN RAISE EXCEPTION 'Could not create private conversation'; END IF;
  RETURN jsonb_build_object('id', convo.id, 'user_a', convo.user_a, 'user_b', convo.user_b);
END;
$$;
GRANT EXECUTE ON FUNCTION public.open_owner_conversation() TO authenticated;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_messages;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL;
END $$;
