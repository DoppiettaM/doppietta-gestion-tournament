-- Affichage public configurable et orchestration complete des challenges.
alter table public.challenges add column if not exists event_date date;
alter table public.challenges add column if not exists venue text;
alter table public.challenges add column if not exists field_names jsonb not null default '[]'::jsonb;
alter table public.challenges add column if not exists match_duration_min smallint not null default 10;
alter table public.challenges add column if not exists rotation_duration_min smallint not null default 3;
alter table public.challenges add column if not exists display_theme text not null default 'blue';
alter table public.challenges add column if not exists display_logo_url text;
alter table public.challenges add column if not exists display_banners jsonb not null default '[]'::jsonb;
alter table public.challenges add column if not exists display_public boolean not null default true;

alter table public.tournaments add column if not exists scoring_rules jsonb not null
  default '{"win":3,"draw":1,"loss":0,"goal_bonus":0}'::jsonb;
alter table public.tournaments add column if not exists display_label text;

create table if not exists public.challenge_events (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 120),
  start_time time not null,
  duration_minutes smallint not null default 0 check (duration_minutes between 0 and 1440),
  event_type text not null default 'ceremony'
    check (event_type in ('welcome','briefing','ceremony','break','announcement','closing')),
  position integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.challenge_events enable row level security;
grant select on public.challenge_events to anon;
grant select, insert, update, delete on public.challenge_events to authenticated;

drop policy if exists "challenge_events_owner_all" on public.challenge_events;
create policy "challenge_events_owner_all" on public.challenge_events
  for all to authenticated
  using (exists (
    select 1 from public.challenges c
    where c.id = challenge_id and c.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.challenges c
    where c.id = challenge_id and c.user_id = (select auth.uid())
  ));

drop policy if exists "public_challenges_read" on public.challenges;
create policy "public_challenges_read" on public.challenges
  for select to anon using (display_public = true);

drop policy if exists "public_challenge_tournaments_read" on public.challenge_tournaments;
create policy "public_challenge_tournaments_read" on public.challenge_tournaments
  for select to anon using (exists (
    select 1 from public.challenges c
    where c.id = challenge_id and c.display_public = true
  ));

drop policy if exists "public_challenge_events_read" on public.challenge_events;
create policy "public_challenge_events_read" on public.challenge_events
  for select to anon using (exists (
    select 1 from public.challenges c
    where c.id = challenge_id and c.display_public = true
  ));

create index if not exists challenge_events_challenge_time_idx
  on public.challenge_events(challenge_id, start_time, position);
