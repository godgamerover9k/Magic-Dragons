-- Paste this into the Supabase SQL editor. Safe to re-run.

create table if not exists public.saves (
  user_id    uuid primary key references auth.users on delete cascade,
  data       jsonb,
  origin_ip  text,
  updated_at timestamptz not null default now()
);

alter table public.saves enable row level security;

-- The browser has no business touching this table. Every read and write goes
-- through /api/game, which validates the action first and uses the service role.
-- With RLS on and no policies, the anon key can do nothing here at all.
drop policy if exists "read own save"   on public.saves;
drop policy if exists "insert own save" on public.saves;
drop policy if exists "update own save" on public.saves;
