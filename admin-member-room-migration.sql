-- GameLink admin controls. Run in Supabase SQL Editor as project owner.
-- Only profiles.role='admin' can use these functions.

CREATE OR REPLACE FUNCTION public.admin_ban_member(target_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only admin can remove members'; END IF;
  IF target_user_id = auth.uid() THEN RAISE EXCEPTION 'Cannot remove your own account'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id=target_user_id AND role='admin') THEN RAISE EXCEPTION 'Cannot remove admin'; END IF;
  UPDATE public.profiles SET banned=true WHERE id=target_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_delete_public_message(target_message_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Only admin can delete public messages'; END IF;
  DELETE FROM public.public_messages WHERE id=target_message_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Public message not found'; END IF;
END; $$;

-- The existing close_trade_room function closes a trade room and removes its membership rows.
GRANT EXECUTE ON FUNCTION public.admin_ban_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_public_message(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_trade_room(uuid) TO authenticated;
GRANT SELECT ON public.trade_rooms TO authenticated;
