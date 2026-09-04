alter table public.challenges
  add column if not exists publish_standings boolean not null default false;

alter table public.tournaments
  add column if not exists publish_standings boolean not null default false;
