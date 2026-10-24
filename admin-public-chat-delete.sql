-- GameLink: allow the primary admin to delete any public chat message.
-- Run in Supabase SQL Editor as project owner.

ALTER TABLE public.public_messages ENABLE ROW LEVEL SECURITY;

-- Direct delete policy for the primary admin; regular members cannot delete others' messages.
DROP POLICY IF EXISTS "primary admin can delete public messages" ON public.public_messages;
CREATE POLICY "primary admin can delete public messages"
ON public.public_messages
FOR DELETE
TO authenticated
USING (public.is_admin());

-- RPC used by the admin-delete button in app.js.
CREATE OR REPLACE FUNCTION public.admin_delete_public_message(target_message_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only the primary admin can delete public chat messages';
  END IF;
  DELETE FROM public.public_messages WHERE id = target_message_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message not found';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_delete_public_message(bigint) TO authenticated;
