-- Paste this into the Supabase SQL editor once, before first use.

create table if not exists public.saves (
  user_id    uuid primary key references auth.users on delete cascade,
  data       jsonb,
  origin_ip  text,
  updated_at timestamptz not null default now()
);

alter table public.saves enable row level security;

-- A player can only ever touch their own row.
create policy "read own save"   on public.saves for select using  (auth.uid() = user_id);
create policy "insert own save" on public.saves for insert with check (auth.uid() = user_id);
create policy "update own save" on public.saves for update using  (auth.uid() = user_id);
