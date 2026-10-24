-- GameLink feature upgrade: staff controls, trade media, profile photos, account lottery.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.trade_messages ADD COLUMN IF NOT EXISTS image_url text;

-- Expand storage allow-list for audio uploads while keeping uploads scoped to each user's folder.
UPDATE storage.buckets SET file_size_limit=10485760,
  allowed_mime_types=ARRAY['image/jpeg','image/png','image/gif','image/webp','image/avif','audio/webm','audio/ogg','audio/mp4','audio/mpeg']
WHERE id='chat-images';

-- Staff can remove members from rooms; ordinary members cannot.
CREATE OR REPLACE FUNCTION public.kick_trade_room_member(target_room_id uuid, target_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
BEGIN
  IF NOT public.is_staff() THEN RAISE EXCEPTION 'Only staff can remove trade room members'; END IF;
  IF target_user_id = auth.uid() THEN RAISE EXCEPTION 'Cannot remove yourself with this action'; END IF;
  DELETE FROM public.trade_room_members WHERE room_id=target_room_id AND user_id=target_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found in this room'; END IF;
END; $$;
GRANT EXECUTE ON FUNCTION public.kick_trade_room_member(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_ban_member(target_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
BEGIN
  IF NOT public.is_staff() THEN RAISE EXCEPTION 'Only staff can ban members'; END IF;
  IF target_user_id=auth.uid() THEN RAISE EXCEPTION 'Cannot ban yourself'; END IF;
  IF EXISTS(SELECT 1 FROM public.profiles WHERE id=target_user_id AND role IN ('admin','assistant')) THEN RAISE EXCEPTION 'Cannot ban staff'; END IF;
  UPDATE public.profiles SET banned=true WHERE id=target_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found'; END IF;
END; $$;
GRANT EXECUTE ON FUNCTION public.admin_ban_member(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.lottery_state (
  id integer PRIMARY KEY CHECK (id=1),
  is_active boolean NOT NULL DEFAULT false,
  winner_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  winner_username text,
  drawn_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.lottery_state(id,is_active) VALUES(1,false) ON CONFLICT(id) DO NOTHING;
ALTER TABLE public.lottery_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lottery state visible to signed in users" ON public.lottery_state;
CREATE POLICY "lottery state visible to signed in users" ON public.lottery_state FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "staff can toggle lottery" ON public.lottery_state;
CREATE POLICY "staff can toggle lottery" ON public.lottery_state FOR UPDATE TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
DROP POLICY IF EXISTS "staff can initialize lottery" ON public.lottery_state;
CREATE POLICY "staff can initialize lottery" ON public.lottery_state FOR INSERT TO authenticated WITH CHECK (public.is_staff());
GRANT SELECT ON public.lottery_state TO authenticated;
GRANT INSERT,UPDATE ON public.lottery_state TO authenticated;

CREATE OR REPLACE FUNCTION public.draw_account_lottery()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth AS $$
DECLARE winner public.profiles%rowtype;
BEGIN
  IF NOT public.is_staff() THEN RAISE EXCEPTION 'Only staff can draw the lottery'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.lottery_state WHERE id=1 AND is_active=true) THEN RAISE EXCEPTION 'Lottery is not active'; END IF;
  SELECT * INTO winner FROM public.profiles WHERE banned=false AND role IN ('member','assistant','admin') ORDER BY random() LIMIT 1;
  IF winner.id IS NULL THEN RAISE EXCEPTION 'No eligible members'; END IF;
  UPDATE public.lottery_state SET winner_user_id=winner.id,winner_username=winner.username,drawn_at=now(),updated_at=now() WHERE id=1;
  RETURN jsonb_build_object('winner_username',winner.username,'winner_user_id',winner.id);
END; $$;
GRANT EXECUTE ON FUNCTION public.draw_account_lottery() TO authenticated;
