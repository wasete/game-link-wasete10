-- GameLink listings activation and staff management.
-- Run once in Supabase SQL Editor as project owner.
CREATE TABLE IF NOT EXISTS public.site_settings (
  id integer PRIMARY KEY CHECK (id = 1),
  listings_active boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.site_settings(id, listings_active) VALUES (1, false)
ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "site settings readable by signed in users" ON public.site_settings;
CREATE POLICY "site settings readable by signed in users" ON public.site_settings
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "staff manage site settings" ON public.site_settings;
CREATE POLICY "staff manage site settings" ON public.site_settings
  FOR UPDATE TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
DROP POLICY IF EXISTS "staff initialize site settings" ON public.site_settings;
CREATE POLICY "staff initialize site settings" ON public.site_settings
  FOR INSERT TO authenticated WITH CHECK (public.is_staff());
GRANT SELECT, INSERT, UPDATE ON public.site_settings TO authenticated;

-- Replace the old listing policies so ordinary users can only add while enabled,
-- and only staff can edit/delete any listing.
DROP POLICY IF EXISTS "active listings readable" ON public.listings;
DROP POLICY IF EXISTS "members create listings" ON public.listings;
DROP POLICY IF EXISTS "owner or staff update listing" ON public.listings;
DROP POLICY IF EXISTS "owner or staff delete listing" ON public.listings;
CREATE POLICY "active listings readable" ON public.listings FOR SELECT TO authenticated
  USING (status = 'active' OR user_id = auth.uid() OR public.is_staff());
CREATE POLICY "members create listings when enabled" ON public.listings FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid() AND public.is_active_member() AND
    (public.is_staff() OR EXISTS (SELECT 1 FROM public.site_settings WHERE id=1 AND listings_active=true))
  );
CREATE POLICY "staff update any listing" ON public.listings FOR UPDATE TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY "staff delete any listing" ON public.listings FOR DELETE TO authenticated
  USING (public.is_staff());
