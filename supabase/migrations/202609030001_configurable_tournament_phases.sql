-- Phases hybrides configurables et liste d'arbitres propre au challenge.
alter table public.challenges
  add column if not exists referee_names jsonb not null default '[]'::jsonb;

alter table public.matches
  add column if not exists phase_key text not null default 'phase_1';

alter table public.matches
  add column if not exists destination_key text;

create index if not exists matches_tournament_phase_idx
  on public.matches(tournament_id, phase_key, destination_key, match_number);

comment on column public.tournaments.bracket_config is
  'Configuration versionnee des phases, reversements par rang, remise a zero et conservation des statistiques.';
comment on column public.challenges.referee_names is
  'Liste ordonnee des arbitres disponibles pour les tournois du challenge.';
