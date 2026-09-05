grant select on table public.challenges to anon, authenticated;
grant select on table public.challenge_tournaments to anon, authenticated;
grant select on table public.challenge_events to anon, authenticated;

drop policy if exists public_challenges_read on public.challenges;
create policy public_challenges_read
on public.challenges for select
to anon, authenticated
using (display_public = true);

drop policy if exists public_challenge_tournaments_read on public.challenge_tournaments;
create policy public_challenge_tournaments_read
on public.challenge_tournaments for select
to anon, authenticated
using (
  exists (
    select 1 from public.challenges c
    where c.id = challenge_tournaments.challenge_id
      and c.display_public = true
  )
);

drop policy if exists public_challenge_events_read on public.challenge_events;
create policy public_challenge_events_read
on public.challenge_events for select
to anon, authenticated
using (
  exists (
    select 1 from public.challenges c
    where c.id = challenge_events.challenge_id
      and c.display_public = true
  )
);
