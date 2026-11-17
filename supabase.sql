-- Medidor de tiempo: tablas y reglas de privacidad.
-- Pégalo entero en Supabase → SQL Editor → New query, y pulsa "Run".

create table if not exists public.settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.days (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  date text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

-- Cada persona solo puede ver y cambiar sus propios datos
alter table public.settings enable row level security;
alter table public.days enable row level security;

drop policy if exists "solo mis ajustes" on public.settings;
create policy "solo mis ajustes" on public.settings
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "solo mis dias" on public.days;
create policy "solo mis dias" on public.days
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.settings, public.days to authenticated;
