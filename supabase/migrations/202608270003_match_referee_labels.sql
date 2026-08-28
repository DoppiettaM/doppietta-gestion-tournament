alter table public.matches
  add column if not exists referee_label text;

comment on column public.matches.referee_label is
  'Nom affiché de l arbitre affecté au match, distinct des équipes participantes.';
