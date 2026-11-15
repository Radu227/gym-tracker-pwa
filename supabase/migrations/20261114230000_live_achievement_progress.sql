-- Keep achievement progress live for every user, not only after unlocking.
-- Run this migration after 20261114223000_update_achievement_rules.sql.

create or replace function public.refresh_achievement_progress_for_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := p_user_id;
  v_first_record numeric(12, 2);
  v_max_increase numeric(12, 2);
  v_max_reps_100 numeric(12, 2);
  v_max_volume_800 numeric(12, 2);
  v_max_volume_1000 numeric(12, 2);
begin
  select case when count(*) > 0 then 1 else 0 end
    into v_first_record
    from public.workout_set_current
   where user_id = v_user_id
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
       where previous_event.user_id = v_user_id
         and not previous_event.is_voided
       group by current_set.exercise_id
    ) as exercise_weights;

  select coalesce(max(reps), 0)
    into v_max_reps_100
    from public.workout_set_current
   where user_id = v_user_id
     and not is_voided
     and weight_kg >= 100;

  select coalesce(max(volume), 0)
    into v_max_volume_800
    from (
      select current_session.routine_id,
             (current_set.performed_at at time zone 'UTC')::date as workout_day,
             sum(current_set.weight_kg * current_set.reps) as volume
        from public.workout_set_current as current_set
        join public.workout_sessions as current_session
          on current_session.id = current_set.session_id
         and current_session.user_id = current_set.user_id
       where current_set.user_id = v_user_id
         and not current_set.is_voided
       group by current_session.routine_id,
                (current_set.performed_at at time zone 'UTC')::date
    ) as volumes;

  v_max_volume_1000 := v_max_volume_800;

  insert into public.user_achievements (
    user_id, achievement_code, progress, target, unlocked_at, updated_at
  )
  values
    (v_user_id, 'first_personal_record', least(v_first_record, 1), 1,
      case when v_first_record >= 1 then now() else null end, now()),
    (v_user_id, 'weight_increase_20kg', least(v_max_increase, 20), 20,
      case when v_max_increase >= 20 then now() else null end, now()),
    (v_user_id, 'set_100kg_8_reps', least(v_max_reps_100, 8), 8,
      case when v_max_reps_100 >= 8 then now() else null end, now()),
    (v_user_id, 'set_100kg_10_reps', least(v_max_reps_100, 10), 10,
      case when v_max_reps_100 >= 10 then now() else null end, now()),
    (v_user_id, 'routine_volume_800', least(v_max_volume_800, 800), 800,
      case when v_max_volume_800 >= 800 then now() else null end, now()),
    (v_user_id, 'routine_volume_1000', least(v_max_volume_1000, 1000), 1000,
      case when v_max_volume_1000 >= 1000 then now() else null end, now())
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

create or replace function public.refresh_achievement_progress()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.refresh_achievement_progress_for_user(new.user_id);
  return new;
end;
$$;

drop trigger if exists workout_set_events_personal_record on public.workout_set_events;

create trigger workout_set_events_personal_record
after insert on public.workout_set_events
for each row execute function public.refresh_achievement_progress();

revoke all on function public.refresh_achievement_progress() from public;
revoke all on function public.refresh_achievement_progress_for_user(uuid) from public;

-- Backfill live progress for users who already have recorded sets.
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
