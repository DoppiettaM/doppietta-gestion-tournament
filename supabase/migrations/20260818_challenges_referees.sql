-- Doppietta Gestion Tournament
-- Refonte challenges multi-tournois + Michel Clipet + arbitrage
-- Migration idempotente et compatible avec les essais Michel Clipet antérieurs.

create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text,
  title text,
  event_date date,
  challenge_date date,
  template text default 'custom',
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Compatibilité si une ancienne version de la table challenges existe déjà.
alter table public.challenges add column if not exists name text;
alter table public.challenges add column if not exists title text;
alter table public.challenges add column if not exists event_date date;
alter table public.challenges add column if not exists challenge_date date;
alter table public.challenges add column if not exists template text default 'custom';
alter table public.challenges add column if not exists config jsonb not null default '{}'::jsonb;
alter table public.challenges add column if not exists created_at timestamptz not null default now();

update public.challenges
set
  name = coalesce(nullif(name, ''), nullif(title, ''), 'Challenge'),
  title = coalesce(nullif(title, ''), nullif(name, ''), 'Challenge'),
  event_date = coalesce(event_date, challenge_date),
  challenge_date = coalesce(challenge_date, event_date),
  template = coalesce(nullif(template, ''), 'custom'),
  config = coalesce(config, '{}'::jsonb);

alter table public.challenges enable row level security;
drop policy if exists "challenge_owner_all" on public.challenges;
drop policy if exists "public read challenges" on public.challenges;
create policy "challenge_owner_all" on public.challenges
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter table public.tournaments add column if not exists challenge_id uuid references public.challenges(id) on delete set null;
alter table public.tournaments add column if not exists category text;
alter table public.tournaments add column if not exists competition_config jsonb not null default '{}'::jsonb;
alter table public.tournaments add column if not exists phase_state jsonb not null default '{}'::jsonb;
create index if not exists tournaments_challenge_id_idx on public.tournaments(challenge_id);

alter table public.matches add column if not exists match_number integer;
alter table public.matches add column if not exists phase_key text default 'phase1';
alter table public.matches add column if not exists penalty_home integer;
alter table public.matches add column if not exists penalty_away integer;
alter table public.matches add column if not exists match_label text;
create unique index if not exists matches_tournament_match_number_uidx
  on public.matches(tournament_id, match_number) where match_number is not null;

alter table public.teams add column if not exists club_name text;
alter table public.teams add column if not exists team_number integer default 1;
alter table public.teams add column if not exists disqualified boolean not null default false;
alter table public.teams add column if not exists tie_break_lot integer default floor(random()*1000000000)::integer;

-- Reprise des noms utilisés par l'ancienne tentative Michel Clipet, s'ils existent.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='teams' and column_name='squad_number'
  ) then
    execute 'update public.teams set team_number = coalesce(squad_number, team_number, 1)';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='teams' and column_name='challenge_disqualified'
  ) then
    execute 'update public.teams set disqualified = coalesce(challenge_disqualified, disqualified, false)';
  end if;
end $$;

update public.teams
set
  club_name = coalesce(nullif(club_name, ''), name),
  team_number = greatest(1, coalesce(team_number, 1))
where club_name is null or club_name = '' or team_number is null or team_number < 1;

create index if not exists teams_club_pair_idx on public.teams(tournament_id, club_name, team_number);

create table if not exists public.referees (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.referee_assignments (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  match_id uuid not null unique references public.matches(id) on delete cascade,
  referee_id uuid not null references public.referees(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists referees_tournament_idx on public.referees(tournament_id);
create index if not exists referee_assignments_tournament_idx on public.referee_assignments(tournament_id);
create index if not exists referee_assignments_referee_idx on public.referee_assignments(referee_id);

alter table public.referees enable row level security;
alter table public.referee_assignments enable row level security;

drop policy if exists "referees_authenticated" on public.referees;
drop policy if exists "referees_owner_all" on public.referees;
create policy "referees_owner_all" on public.referees
  for all to authenticated
  using (exists (
    select 1 from public.tournaments t
    where t.id = referees.tournament_id and t.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.tournaments t
    where t.id = referees.tournament_id and t.user_id = (select auth.uid())
  ));

-- Les noms d'arbitres affectés sont volontairement lisibles par l'écran public du tournoi.
drop policy if exists "referees_public_read" on public.referees;
create policy "referees_public_read" on public.referees
  for select to anon, authenticated using (true);

drop policy if exists "assignments_authenticated" on public.referee_assignments;
drop policy if exists "assignments_owner_all" on public.referee_assignments;
create policy "assignments_owner_all" on public.referee_assignments
  for all to authenticated
  using (exists (
    select 1 from public.tournaments t
    where t.id = referee_assignments.tournament_id and t.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.tournaments t
    where t.id = referee_assignments.tournament_id and t.user_id = (select auth.uid())
  ));

drop policy if exists "assignments_public_read" on public.referee_assignments;
create policy "assignments_public_read" on public.referee_assignments
  for select to anon, authenticated using (true);
