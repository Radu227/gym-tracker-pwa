-- Award the first personal-record achievement whenever a new maximum weight
-- is appended to the immutable workout-set event log.

create or replace function public.update_personal_record_achievement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exercise_id uuid;
  v_previous_max numeric(7, 2);
begin
  if new.is_voided then
    return new;
  end if;

  select s.exercise_id
    into v_exercise_id
    from public.workout_sets as s
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
    values (
      new.user_id, 'first_personal_record', 1, 1, now(), now()
    )
    on conflict (user_id, achievement_code)
    do update set
      progress = greatest(public.user_achievements.progress, excluded.progress),
      target = excluded.target,
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

-- Backfill the achievement for existing users who already have at least one
-- recorded set before this migration is applied.
insert into public.user_achievements (
  user_id, achievement_code, progress, target, unlocked_at, updated_at
)
select distinct
  events.user_id,
  'first_personal_record',
  1,
  1,
  now(),
  now()
from public.workout_set_events as events
where events.event_type in ('recorded', 'corrected')
  and not events.is_voided
on conflict (user_id, achievement_code)
do update set
  progress = greatest(public.user_achievements.progress, excluded.progress),
  target = excluded.target,
  unlocked_at = coalesce(public.user_achievements.unlocked_at, excluded.unlocked_at),
  updated_at = now();

revoke all on function public.update_personal_record_achievement() from public;
