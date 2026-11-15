-- Weekly achievements are evaluated from Monday through Sunday and are
-- recalculated whenever a new current set is recorded.

update public.achievement_definitions
set is_active = false
where code = 'weekly_goal_streak_4';

insert into public.achievement_definitions (code, title, description, criteria)
values
  ('weekly_three_days', 'Trei zile active', 'Înregistrează serii în trei zile diferite în această săptămână.', '{"type":"weekly_active_days","days":3}'::jsonb),
  ('weekly_five_days', 'Cinci zile active', 'Înregistrează serii în cinci zile diferite în această săptămână.', '{"type":"weekly_active_days","days":5}'::jsonb),
  ('weekly_seven_days', 'Săptămână completă', 'Înregistrează serii în fiecare zi a săptămânii.', '{"type":"weekly_active_days","days":7}'::jsonb)
on conflict (code) do update set
  title = excluded.title,
  description = excluded.description,
  criteria = excluded.criteria,
  is_active = true;

create or replace function public.refresh_weekly_achievement_progress()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_week_start date := date_trunc('week', now() at time zone 'UTC')::date;
  v_active_days numeric(12, 2);
begin
  select count(distinct (performed_at at time zone 'UTC')::date)
    into v_active_days
    from public.workout_set_current
   where user_id = new.user_id
     and not is_voided
     and (performed_at at time zone 'UTC')::date >= v_week_start
     and (performed_at at time zone 'UTC')::date < v_week_start + 7;

  insert into public.user_achievements (
    user_id, achievement_code, progress, target, unlocked_at, updated_at
  )
  values
    (new.user_id, 'weekly_three_days', least(v_active_days, 3), 3,
      case when v_active_days >= 3 then now() else null end, now()),
    (new.user_id, 'weekly_five_days', least(v_active_days, 5), 5,
      case when v_active_days >= 5 then now() else null end, now()),
    (new.user_id, 'weekly_seven_days', least(v_active_days, 7), 7,
      case when v_active_days >= 7 then now() else null end, now())
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

  return new;
end;
$$;

drop trigger if exists workout_set_events_weekly_achievements on public.workout_set_events;

create trigger workout_set_events_weekly_achievements
after insert on public.workout_set_events
for each row execute function public.refresh_weekly_achievement_progress();

revoke all on function public.refresh_weekly_achievement_progress() from public;
