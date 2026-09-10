update public.challenges
set scheduling_rules = coalesce(scheduling_rules, '{}'::jsonb)
  || jsonb_build_object(
    'max_match_count_gap', 1,
    'min_rest_slots', greatest(1, coalesce((scheduling_rules ->> 'min_rest_slots')::integer, 1)),
    'prevent_simultaneous', true,
    'rest_policy', 'strict',
    'phase_transition_min', greatest(10, coalesce((scheduling_rules ->> 'phase_transition_min')::integer, 10))
  );
