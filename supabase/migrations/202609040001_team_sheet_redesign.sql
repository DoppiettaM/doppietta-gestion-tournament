alter table public.tournaments
  add column if not exists venue text,
  add column if not exists min_staff_per_team integer not null default 1,
  add column if not exists max_staff_per_team integer not null default 5;

alter table public.challenges
  add column if not exists min_players_per_team integer,
  add column if not exists max_players_per_team integer,
  add column if not exists min_staff_per_team integer,
  add column if not exists max_staff_per_team integer;

alter table public.teams
  add column if not exists sheet_validated_at timestamptz,
  add column if not exists sheet_validation_incomplete boolean not null default false,
  add column if not exists sheet_updated_at timestamptz;

alter table public.tournaments drop constraint if exists tournaments_staff_limits_check;
alter table public.tournaments add constraint tournaments_staff_limits_check
  check (min_staff_per_team >= 1 and max_staff_per_team >= min_staff_per_team);

alter table public.challenges drop constraint if exists challenges_roster_limits_check;
alter table public.challenges add constraint challenges_roster_limits_check check (
  (min_players_per_team is null or min_players_per_team >= 1) and
  (max_players_per_team is null or max_players_per_team >= coalesce(min_players_per_team, 1)) and
  (min_staff_per_team is null or min_staff_per_team >= 1) and
  (max_staff_per_team is null or max_staff_per_team >= coalesce(min_staff_per_team, 1))
);

create or replace function public.save_public_team_sheet(
  p_team_id uuid,
  p_tournament_id uuid,
  p_token text,
  p_players jsonb,
  p_staff jsonb,
  p_incomplete boolean
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_token is null or p_token = '' or
     coalesce((select t.public_sheet_token = p_token
               from public.teams t
               where t.id = p_team_id and t.tournament_id = p_tournament_id), false) is false then
    raise exception 'Lien de fiche invalide';
  end if;

  delete from public.players where team_id = p_team_id;

  insert into public.players (
    tournament_id, team_id, first_name, last_name, jersey_number, license_number, birth_date
  )
  select
    p_tournament_id,
    p_team_id,
    nullif(btrim(x.first_name), ''),
    nullif(btrim(x.last_name), ''),
    x.jersey_number,
    case when x.no_license then null else nullif(btrim(x.license_number), '') end,
    x.birth_date
  from jsonb_to_recordset(coalesce(p_players, '[]'::jsonb)) as x(
    first_name text,
    last_name text,
    jersey_number integer,
    license_number text,
    no_license boolean,
    birth_date date
  );

  update public.teams
  set staff = coalesce(p_staff, '[]'::jsonb),
      sheet_validated_at = now(),
      sheet_validation_incomplete = coalesce(p_incomplete, false),
      sheet_updated_at = now()
  where id = p_team_id and tournament_id = p_tournament_id;

  if not found then raise exception 'Équipe introuvable'; end if;
end;
$$;

revoke all on function public.save_public_team_sheet(uuid, uuid, text, jsonb, jsonb, boolean) from public;
grant execute on function public.save_public_team_sheet(uuid, uuid, text, jsonb, jsonb, boolean) to anon, authenticated;
