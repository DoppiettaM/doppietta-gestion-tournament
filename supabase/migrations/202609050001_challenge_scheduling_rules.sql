alter table public.challenges
  add column if not exists scheduling_rules jsonb not null default '{"max_match_count_gap":1,"min_rest_slots":1,"prevent_simultaneous":true,"rest_policy":"prefer_then_relax"}'::jsonb;

update public.challenges
set scheduling_rules = '{"max_match_count_gap":1,"min_rest_slots":1,"prevent_simultaneous":true,"rest_policy":"prefer_then_relax"}'::jsonb
where scheduling_rules is null;
