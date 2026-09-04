with ordered as (
  select id, row_number() over (
    partition by tournament_id
    order by team_number nulls last, created_at, id
  )::integer as new_team_number
  from public.teams
)
update public.teams t
set team_number = ordered.new_team_number
from ordered
where ordered.id = t.id
  and t.team_number is distinct from ordered.new_team_number;

create index if not exists teams_tournament_order_idx
  on public.teams (tournament_id, team_number, created_at);
