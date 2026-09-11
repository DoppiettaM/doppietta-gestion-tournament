-- Private dashboard rows belong to their creator. Public reads are limited to
-- tournaments explicitly exposed through a published challenge (or a team-sheet token).
drop policy if exists "public read tournaments" on public.tournaments;
drop policy if exists "public read teams" on public.teams;
drop policy if exists "public read matches" on public.matches;
drop policy if exists "public read match_events" on public.match_events;
drop policy if exists "referees_public_read" on public.referees;
drop policy if exists "assignments_public_read" on public.referee_assignments;

create policy "public read published challenge tournaments" on public.tournaments
for select to anon, authenticated using (exists (
  select 1 from public.challenge_tournaments ct join public.challenges c on c.id=ct.challenge_id
  where ct.tournament_id=tournaments.id and c.display_public=true));
create policy "public read published challenge teams" on public.teams
for select to anon, authenticated using (exists (
  select 1 from public.challenge_tournaments ct join public.challenges c on c.id=ct.challenge_id
  where ct.tournament_id=teams.tournament_id and c.display_public=true));
create policy "public read published challenge matches" on public.matches
for select to anon, authenticated using (exists (
  select 1 from public.challenge_tournaments ct join public.challenges c on c.id=ct.challenge_id
  where ct.tournament_id=matches.tournament_id and c.display_public=true));
create policy "public read published challenge match events" on public.match_events
for select to anon, authenticated using (exists (
  select 1 from public.challenge_tournaments ct join public.challenges c on c.id=ct.challenge_id
  where ct.tournament_id=match_events.tournament_id and c.display_public=true));
create policy "public read published challenge referees" on public.referees
for select to anon, authenticated using (exists (
  select 1 from public.challenge_tournaments ct join public.challenges c on c.id=ct.challenge_id
  where ct.tournament_id=referees.tournament_id and c.display_public=true));
create policy "public read published challenge assignments" on public.referee_assignments
for select to anon, authenticated using (exists (
  select 1 from public.challenge_tournaments ct join public.challenges c on c.id=ct.challenge_id
  where ct.tournament_id=referee_assignments.tournament_id and c.display_public=true));
