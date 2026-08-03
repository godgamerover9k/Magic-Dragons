-- Paste this into the Supabase SQL editor. Safe to re-run.

-- ---------------------------------------------------------------------------
-- Saves
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Leaderboard
--
-- Kept apart from saves so a public board can be served without touching
-- anyone's progress. `chosen` records that the player has answered the naming
-- question, so they are only ever asked once.
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  user_id      uuid primary key references auth.users on delete cascade,
  display_name text,
  anonymous    boolean not null default true,
  chosen       boolean not null default false,
  discovered   integer not null default 0,
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;
drop policy if exists "read profiles" on public.profiles;

create index if not exists profiles_discovered_idx
  on public.profiles (discovered desc, updated_at asc);

-- ---------------------------------------------------------------------------
-- Housekeeping
--
-- A guest keeper is tied to one browser and cannot be signed back into. Once a
-- month has passed with no sign of them, the account and its save are removed.
-- Named accounts are never touched, however long they are left.
-- ---------------------------------------------------------------------------

create or replace function public.purge_stale_guests(older_than interval default '30 days')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  with stale as (
    select u.id
    from auth.users u
    left join public.saves s on s.user_id = u.id
    where u.is_anonymous is true
      and coalesce(s.updated_at, u.created_at) < now() - older_than
      and coalesce(u.last_sign_in_at, u.created_at) < now() - older_than
  )
  delete from auth.users where id in (select id from stale);
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- Only the service role may run it. Nobody's browser can.
revoke all on function public.purge_stale_guests(interval) from public, anon, authenticated;
