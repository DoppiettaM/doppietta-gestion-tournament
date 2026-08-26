-- Challenges multi-tournois (2 a 6 tournois)
create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) > 0),
  scoring_mode text not null default 'placement_points'
    check (scoring_mode in ('placement_points', 'tournament_points', 'goals_scored')),
  default_points_by_rank jsonb not null default '[10,8,6,5,4,3,2,1]'::jsonb,
  tie_breakers jsonb not null default '["points","goal_difference","goals_scored"]'::jsonb,
  shared_resources boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.challenge_tournaments (
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  position smallint not null check (position between 1 and 6),
  points_by_rank jsonb,
  primary key (challenge_id, tournament_id),
  unique (challenge_id, position)
);

alter table public.teams add column if not exists challenge_name text;
alter table public.tournaments add column if not exists standings_tiebreakers jsonb
  default '["points","goal_difference","goals_scored"]'::jsonb;
alter table public.tournaments add column if not exists knockout_tiebreakers jsonb
  default '["extra_time","penalty_shootout","draw"]'::jsonb;
alter table public.tournaments add column if not exists bracket_config jsonb default '{}'::jsonb;
alter table public.tournaments add column if not exists referee_rest_slots smallint not null default 1;
alter table public.matches add column if not exists match_number integer;
alter table public.matches add column if not exists stage text not null default 'league';
alter table public.matches add column if not exists round_label text;
alter table public.matches add column if not exists home_source_label text;
alter table public.matches add column if not exists away_source_label text;
alter table public.matches add column if not exists referee_team_id uuid references public.teams(id) on delete set null;
alter table public.matches add column if not exists schedule_order integer;

alter table public.challenges enable row level security;
alter table public.challenge_tournaments enable row level security;

drop policy if exists "challenge_owner_all" on public.challenges;
create policy "challenge_owner_all" on public.challenges
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "challenge_tournaments_owner_all" on public.challenge_tournaments;
create policy "challenge_tournaments_owner_all" on public.challenge_tournaments
  for all using (
    exists (select 1 from public.challenges c where c.id = challenge_id and c.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.challenges c where c.id = challenge_id and c.user_id = auth.uid())
  );

create index if not exists challenge_tournaments_tournament_idx
  on public.challenge_tournaments(tournament_id);
create index if not exists teams_challenge_name_idx
  on public.teams(tournament_id, challenge_name);
