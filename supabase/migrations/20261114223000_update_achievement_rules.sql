-- Updated achievement rules and a single trigger that evaluates every newly
-- recorded or corrected workout-set event.

update public.achievement_definitions
set is_active = false
where code = 'session_volume_10000';

insert into public.achievement_definitions (code, title, description, criteria)
values
  ('set_100kg_8_reps', '100 kg × 8 repetări',
   'Înregistrează o serie de 100 kg cu 8 repetări.',
   '{"type":"set_weight_reps","weight_kg":100,"reps":8}'::jsonb),
  ('set_100kg_10_reps', '100 kg × 10 repetări',
   'Înregistrează o serie de 100 kg cu 10 repetări.',
   '{"type":"set_weight_reps","weight_kg":100,"reps":10}'::jsonb),
  ('weight_increase_20kg', 'Progres de 20 kg',
   'Crește greutatea maximă la un exercițiu cu cel puțin 20 kg.',
   '{"type":"weight_increase_kg","value":20}'::jsonb),
  ('routine_volume_800', '800 kg într-un antrenament',
   'Ridică un volum cumulat de cel puțin 800 kg într-un antrenament.',
   '{"type":"routine_volume_kg","value":800}'::jsonb),
  ('routine_volume_1000', '1000 kg într-un antrenament',
   'Ridică un volum cumulat de cel puțin 1000 kg într-un antrenament.',
   '{"type":"routine_volume_kg","value":1000}'::jsonb)
on conflict (code) do update set
  title = excluded.title,
  description = excluded.description,
  criteria = excluded.criteria,
  is_active = true;

create or replace function public.update_personal_record_achievement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exercise_id uuid;
  v_routine_id uuid;
  v_previous_max numeric(7, 2);
  v_routine_volume numeric(12, 2);
  v_workout_day date;
begin
  if new.is_voided then
    return new;
  end if;

  select s.exercise_id, sessions.routine_id
    into v_exercise_id, v_routine_id
    from public.workout_sets as s
    join public.workout_sessions as sessions
      on sessions.id = s.session_id
     and sessions.user_id = s.user_id
   where s.id = new.workout_set_id
     and s.user_id = new.user_id;

  if v_exercise_id is null then
    return new;
  end if;

  select max(previous_event.weight_kg)
    into v_previous_max
    from public.workout_set_events as previous_event
    join public.workout_sets as previous_set
      on previous_set.id = previous_event.workout_set_id
     and previous_set.user_id = previous_event.user_id
   where previous_event.user_id = new.user_id
     and previous_set.exercise_id = v_exercise_id
     and previous_event.id <> new.id
     and not previous_event.is_voided;

  if v_previous_max is null or new.weight_kg > v_previous_max then
    insert into public.user_achievements (
      user_id, achievement_code, progress, target, unlocked_at, updated_at
    )
    values (new.user_id, 'first_personal_record', 1, 1, now(), now())
    on conflict (user_id, achievement_code)
    do update set
      progress = greatest(public.user_achievements.progress, excluded.progress),
      unlocked_at = coalesce(public.user_achievements.unlocked_at, excluded.unlocked_at),
      updated_at = now();
  end if;

  if v_previous_max is not null and new.weight_kg >= v_previous_max + 20 then
    insert into public.user_achievements (
      user_id, achievement_code, progress, target, unlocked_at, updated_at
    )
    values (new.user_id, 'weight_increase_20kg', 1, 1, now(), now())
    on conflict (user_id, achievement_code)
    do update set
      progress = greatest(public.user_achievements.progress, excluded.progress),
      unlocked_at = coalesce(public.user_achievements.unlocked_at, excluded.unlocked_at),
      updated_at = now();
  end if;

  if new.weight_kg >= 100 and new.reps = 8 then
    insert into public.user_achievements (
      user_id, achievement_code, progress, target, unlocked_at, updated_at
    )
    values (new.user_id, 'set_100kg_8_reps', 1, 1, now(), now())
    on conflict (user_id, achievement_code)
    do update set
      progress = 1,
      unlocked_at = coalesce(public.user_achievements.unlocked_at, excluded.unlocked_at),
      updated_at = now();
  end if;

  if new.weight_kg >= 100 and new.reps = 10 then
    insert into public.user_achievements (
      user_id, achievement_code, progress, target, unlocked_at, updated_at
    )
    values (new.user_id, 'set_100kg_10_reps', 1, 1, now(), now())
    on conflict (user_id, achievement_code)
    do update set
      progress = 1,
      unlocked_at = coalesce(public.user_achievements.unlocked_at, excluded.unlocked_at),
      updated_at = now();
  end if;

  v_workout_day := (new.performed_at at time zone 'UTC')::date;
  select coalesce(sum(current_set.weight_kg * current_set.reps), 0)
    into v_routine_volume
    from public.workout_set_current as current_set
    join public.workout_sessions as current_session
      on current_session.id = current_set.session_id
     and current_session.user_id = current_set.user_id
   where current_set.user_id = new.user_id
     and current_session.routine_id = v_routine_id
     and (current_set.performed_at at time zone 'UTC')::date = v_workout_day
     and not current_set.is_voided;

  if v_routine_volume >= 800 then
    insert into public.user_achievements (
      user_id, achievement_code, progress, target, unlocked_at, updated_at
    )
    values (
      new.user_id, 'routine_volume_800', v_routine_volume, 800,
      case when v_routine_volume >= 800 then now() else null end, now()
    )
    on conflict (user_id, achievement_code)
    do update set
      progress = greatest(public.user_achievements.progress, excluded.progress),
      unlocked_at = coalesce(public.user_achievements.unlocked_at, excluded.unlocked_at),
      updated_at = now();
  end if;

  if v_routine_volume >= 1000 then
    insert into public.user_achievements (
      user_id, achievement_code, progress, target, unlocked_at, updated_at
    )
    values (new.user_id, 'routine_volume_1000', v_routine_volume, 1000, now(), now())
    on conflict (user_id, achievement_code)
    do update set
      progress = greatest(public.user_achievements.progress, excluded.progress),
      unlocked_at = coalesce(public.user_achievements.unlocked_at, excluded.unlocked_at),
      updated_at = now();
  end if;

  return new;
end;
$$;

drop trigger if exists workout_set_events_personal_record on public.workout_set_events;

create trigger workout_set_events_personal_record
after insert on public.workout_set_events
for each row execute function public.update_personal_record_achievement();

revoke all on function public.update_personal_record_achievement() from public;

-- Backfill achievements for current data when the migration is applied after
-- users have already recorded or corrected sets.
insert into public.user_achievements (
  user_id, achievement_code, progress, target, unlocked_at, updated_at
)
select distinct user_id, 'first_personal_record', 1, 1, now(), now()
from public.workout_set_current
where not is_voided
on conflict (user_id, achievement_code)
do update set
  progress = greatest(public.user_achievements.progress, excluded.progress),
  unlocked_at = coalesce(public.user_achievements.unlocked_at, excluded.unlocked_at),
  updated_at = now();

insert into public.user_achievements (
  user_id, achievement_code, progress, target, unlocked_at, updated_at
)
select distinct user_id, 'set_100kg_8_reps', 1, 1, now(), now()
from public.workout_set_current
where not is_voided and weight_kg >= 100 and reps = 8
on conflict (user_id, achievement_code)
do update set
  progress = 1,
  unlocked_at = coalesce(public.user_achievements.unlocked_at, excluded.unlocked_at),
  updated_at = now();

insert into public.user_achievements (
  user_id, achievement_code, progress, target, unlocked_at, updated_at
)
select distinct user_id, 'set_100kg_10_reps', 1, 1, now(), now()
from public.workout_set_current
where not is_voided and weight_kg >= 100 and reps = 10
on conflict (user_id, achievement_code)
do update set
  progress = 1,
  unlocked_at = coalesce(public.user_achievements.unlocked_at, excluded.unlocked_at),
  updated_at = now();
