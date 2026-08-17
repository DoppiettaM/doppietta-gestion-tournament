-- Challenge Michel Clipet: two linked U8/U9 tournaments + phase metadata.
create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null default 'Challenge Michel Clipet',
  challenge_date date,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on table public.challenges to authenticated;
alter table public.challenges enable row level security;

drop policy if exists "challenge_owner_all" on public.challenges;
create policy "challenge_owner_all" on public.challenges
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

alter table public.tournaments add column if not exists challenge_id uuid references public.challenges(id) on delete cascade;
alter table public.tournaments add column if not exists category text;
alter table public.tournaments add column if not exists phase1_locked boolean not null default false;

alter table public.tournaments drop constraint if exists tournaments_format_allowed;
alter table public.tournaments drop constraint if exists tournaments_format_check;
alter table public.tournaments add constraint tournaments_format_check
check (format = any (array['round_robin'::text,'groups_round_robin'::text,'michel_clipet'::text]));

alter table public.tournaments drop constraint if exists tournaments_category_check;
alter table public.tournaments add constraint tournaments_category_check
check (category is null or category in ('U8','U9'));

alter table public.teams add column if not exists club_name text;
alter table public.teams add column if not exists squad_number integer not null default 1;
alter table public.teams add column if not exists challenge_disqualified boolean not null default false;
alter table public.teams add constraint teams_squad_number_check check (squad_number >= 1 and squad_number <= 20);

alter table public.matches add column if not exists match_number integer;
alter table public.matches add column if not exists phase text;
alter table public.matches add column if not exists stage text;
alter table public.matches add column if not exists penalty_home integer;
alter table public.matches add column if not exists penalty_away integer;
alter table public.matches add column if not exists winner_team_id uuid references public.teams(id) on delete set null;

create unique index if not exists matches_tournament_match_number_uq
on public.matches(tournament_id, match_number) where match_number is not null;
create index if not exists tournaments_challenge_id_idx on public.tournaments(challenge_id);
create index if not exists teams_club_pair_idx on public.teams(club_name, squad_number);
create index if not exists matches_winner_team_id_idx on public.matches(winner_team_id);
