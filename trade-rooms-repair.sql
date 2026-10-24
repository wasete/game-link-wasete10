-- GameLink: repair trade-room permissions and messaging.
-- Run this once in Supabase SQL Editor while signed in as project owner.

ALTER TABLE public.trade_messages ADD COLUMN IF NOT EXISTS image_url text;

-- Security-definer membership check prevents recursive RLS on trade_room_members.
CREATE OR REPLACE FUNCTION public.is_trade_room_member(target_room_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.trade_room_members m
    WHERE m.room_id = target_room_id AND m.user_id = auth.uid()
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_trade_room_member(uuid) TO authenticated;

-- Replace policies safely, including policies from earlier versions.
DROP POLICY IF EXISTS "room members and staff can read rooms" ON public.trade_rooms;
DROP POLICY IF EXISTS "room members readable by members and staff" ON public.trade_room_members;
DROP POLICY IF EXISTS "room messages readable by members" ON public.trade_messages;
DROP POLICY IF EXISTS "room members send messages" ON public.trade_messages;
DROP POLICY IF EXISTS "trade rooms visible to members or staff" ON public.trade_rooms;
DROP POLICY IF EXISTS "trade room membership visible to room members" ON public.trade_room_members;
DROP POLICY IF EXISTS "trade messages visible to room members or staff" ON public.trade_messages;
DROP POLICY IF EXISTS "trade room members can send messages" ON public.trade_messages;

CREATE POLICY "trade rooms visible to members or staff"
ON public.trade_rooms FOR SELECT TO authenticated
USING (public.is_staff() OR creator_id = auth.uid() OR public.is_trade_room_member(id));

CREATE POLICY "trade room membership visible to room members"
ON public.trade_room_members FOR SELECT TO authenticated
USING (public.is_staff() OR user_id = auth.uid() OR public.is_trade_room_member(room_id));

CREATE POLICY "trade messages visible to room members or staff"
ON public.trade_messages FOR SELECT TO authenticated
USING (public.is_staff() OR public.is_trade_room_member(room_id));

CREATE POLICY "trade room members can send messages"
ON public.trade_messages FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND public.is_active_member()
  AND EXISTS (SELECT 1 FROM public.trade_rooms r WHERE r.id = room_id AND r.status = 'active')
  AND public.is_trade_room_member(room_id)
);

GRANT SELECT ON public.trade_rooms TO authenticated;
GRANT SELECT ON public.trade_room_members TO authenticated;
GRANT SELECT, INSERT ON public.trade_messages TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.trade_messages_id_seq TO authenticated;

-- Only the primary admin can create rooms. Hiding the form in the UI is not security by itself.
CREATE OR REPLACE FUNCTION public.create_trade_room(room_title text, buyer_username text, seller_username text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE rid uuid; code text; admin_id uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only the primary admin can create trade rooms'; END IF;
  IF coalesce(trim(room_title),'') = '' OR coalesce(trim(buyer_username),'') = '' OR coalesce(trim(seller_username),'') = '' THEN
    RAISE EXCEPTION 'Required fields missing';
  END IF;
  admin_id := auth.uid();
  code := 'GL-' || upper(substr(encode(extensions.gen_random_bytes(5),'hex'),1,6));
  INSERT INTO public.trade_rooms(title, invite_code, creator_id, buyer_username, seller_username)
  VALUES(trim(room_title), code, admin_id, trim(buyer_username), trim(seller_username)) RETURNING id INTO rid;
  INSERT INTO public.trade_room_members(room_id,user_id) VALUES(rid,admin_id) ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('id',rid,'invite_code',code,'title',trim(room_title));
END; $$;
GRANT EXECUTE ON FUNCTION public.create_trade_room(text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.close_trade_room(room_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only the primary admin can close trade rooms'; END IF;
  UPDATE public.trade_rooms SET status='closed', closed_at=now() WHERE id=room_id AND status <> 'closed';
  IF NOT FOUND THEN RAISE EXCEPTION 'Room not found or already closed'; END IF;
  DELETE FROM public.trade_room_members WHERE trade_room_members.room_id=close_trade_room.room_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.close_trade_room(uuid) TO authenticated;

-- Ensure realtime message updates are enabled where supported.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.trade_messages;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL;
END $$;
