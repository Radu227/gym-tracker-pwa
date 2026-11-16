update public.achievement_definitions
set is_active = false
where code in ('routine_volume_800', 'routine_volume_1000');

insert into public.achievement_definitions (code, title, description, criteria)
values
  ('routine_volume_5000', '5.000 kg într-un antrenament',
   'Ridică un volum cumulat de cel puțin 5.000 kg într-un antrenament.',
   '{"type":"routine_volume_kg","value":5000}'::jsonb),
  ('routine_volume_8000', '8.000 kg într-un antrenament',
   'Ridică un volum cumulat de cel puțin 8.000 kg într-un antrenament.',
   '{"type":"routine_volume_kg","value":8000}'::jsonb),
  ('routine_volume_10000', '10.000 kg într-un antrenament',
   'Ridică un volum cumulat de cel puțin 10.000 kg într-un antrenament.',
   '{"type":"routine_volume_kg","value":10000}'::jsonb)
on conflict (code) do update set
  title = excluded.title,
  description = excluded.description,
  criteria = excluded.criteria,
  is_active = true;

create or replace function public.refresh_achievement_progress_for_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first_record numeric(12, 2);
  v_max_increase numeric(12, 2);
  v_max_reps_100 numeric(12, 2);
  v_max_volume numeric(12, 2);
begin
  select case when count(*) > 0 then 1 else 0 end
    into v_first_record
    from public.workout_set_current
   where user_id = p_user_id
     and not is_voided;

  select coalesce(max(weight_kg - minimum_weight_kg), 0)
    into v_max_increase
    from (
      select current_set.exercise_id,
             max(previous_event.weight_kg) as weight_kg,
             min(previous_event.weight_kg) as minimum_weight_kg
        from public.workout_set_events as previous_event
        join public.workout_sets as current_set
          on current_set.id = previous_event.workout_set_id
         and current_set.user_id = previous_event.user_id
       where previous_event.user_id = p_user_id
         and not previous_event.is_voided
       group by current_set.exercise_id
    ) as exercise_weights;

  select coalesce(max(reps), 0)
    into v_max_reps_100
    from public.workout_set_current
   where user_id = p_user_id
     and not is_voided
     and weight_kg >= 100;

  select coalesce(max(volume), 0)
    into v_max_volume
    from (
      select current_session.routine_id,
             (current_set.performed_at at time zone 'UTC')::date as workout_day,
             sum(current_set.weight_kg * current_set.reps) as volume
        from public.workout_set_current as current_set
        join public.workout_sessions as current_session
          on current_session.id = current_set.session_id
         and current_session.user_id = current_set.user_id
       where current_set.user_id = p_user_id
         and not current_set.is_voided
       group by current_session.routine_id,
                (current_set.performed_at at time zone 'UTC')::date
    ) as volumes;

  insert into public.user_achievements (
    user_id, achievement_code, progress, target, unlocked_at, updated_at
  )
  values
    (p_user_id, 'first_personal_record', least(v_first_record, 1), 1,
      case when v_first_record >= 1 then now() else null end, now()),
    (p_user_id, 'weight_increase_20kg', least(v_max_increase, 20), 20,
      case when v_max_increase >= 20 then now() else null end, now()),
    (p_user_id, 'set_100kg_8_reps', least(v_max_reps_100, 8), 8,
      case when v_max_reps_100 >= 8 then now() else null end, now()),
    (p_user_id, 'set_100kg_10_reps', least(v_max_reps_100, 10), 10,
      case when v_max_reps_100 >= 10 then now() else null end, now()),
    (p_user_id, 'routine_volume_5000', least(v_max_volume, 5000), 5000,
      case when v_max_volume >= 5000 then now() else null end, now()),
    (p_user_id, 'routine_volume_8000', least(v_max_volume, 8000), 8000,
      case when v_max_volume >= 8000 then now() else null end, now()),
    (p_user_id, 'routine_volume_10000', least(v_max_volume, 10000), 10000,
      case when v_max_volume >= 10000 then now() else null end, now())
  on conflict (user_id, achievement_code)
  do update set
    progress = excluded.progress,
    target = excluded.target,
    unlocked_at = case
      when excluded.progress >= excluded.target
        then coalesce(public.user_achievements.unlocked_at, excluded.unlocked_at, now())
      else null
    end,
    updated_at = now();
end;
$$;

do $$
declare
  v_user_id uuid;
begin
  for v_user_id in
    select distinct user_id from public.workout_set_events
  loop
    perform public.refresh_achievement_progress_for_user(v_user_id);
  end loop;
end;
$$;
