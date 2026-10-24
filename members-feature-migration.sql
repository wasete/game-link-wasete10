-- GameLink members directory + editable usernames
-- Run this once in Supabase SQL Editor if the current profiles policies are not already installed.
alter table public.profiles enable row level security;
drop policy if exists "profiles readable to signed in users" on public.profiles;
create policy "profiles readable to signed in users" on public.profiles for select to authenticated using (true);
drop policy if exists "users update own profile basics" on public.profiles;
create policy "users update own profile basics" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
