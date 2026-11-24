-- Allow retroactive missed-workout logging from the Progress calendar.

alter table public.daily_workout_logs
  drop constraint if exists daily_workout_logs_mode_check;

alter table public.daily_workout_logs
  add constraint daily_workout_logs_mode_check
  check (mode in ('already_done', 'started_now', 'retroactive', 'legacy_backfill'));

create or replace function public.log_past_daily_workout(
  p_routine_id uuid,
  p_workout_date date
)
returns setof public.daily_workout_logs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_today date := (now() at time zone 'Europe/Bucharest')::date;
  v_routine_name text;
  v_as_of timestamptz;
  v_snapshot jsonb;
  v_total numeric(12, 2);
  v_inserted public.daily_workout_logs%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_routine_id is null or p_workout_date is null then
    raise exception 'Antrenamentul și data sunt obligatorii.';
  end if;
  if p_workout_date > v_today then
    raise exception 'Nu poți înregistra un antrenament pentru o dată din viitor.';
  end if;

  perform public.finalize_due_daily_workouts();

  if exists (
    select 1
    from public.daily_workout_logs
    where user_id = v_user_id
      and workout_date = p_workout_date
      and source = 'checkin'
      and status in ('in_progress', 'completed')
  ) then
    raise exception 'Ai înregistrat deja un antrenament pentru această zi.';
  end if;

  if exists (
    select 1
    from public.daily_workout_logs
    where user_id = v_user_id
      and source = 'legacy_backfill'
      and date_trunc('week', workout_date::timestamp)::date = date_trunc('week', p_workout_date::timestamp)::date
  ) then
    raise exception 'Volumul acestei săptămâni a fost deja salvat automat la migrare și nu poate fi duplicat.';
  end if;

  select r.name
    into v_routine_name
    from public.routines as r
   where r.id = p_routine_id
     and r.user_id = v_user_id;

  if not found then
    raise exception 'Antrenamentul selectat nu a fost găsit.';
  end if;

  if p_workout_date < v_today then
    v_as_of := ((p_workout_date + 1)::timestamp at time zone 'Europe/Bucharest') - interval '1 microsecond';
  else
    v_as_of := now();
  end if;

  select s.sets_snapshot, s.total_volume_kg
    into v_snapshot, v_total
    from public.compute_routine_sets_snapshot(v_user_id, p_routine_id, v_as_of) as s;

  insert into public.daily_workout_logs (
    user_id,
    workout_date,
    routine_id,
    routine_name_snapshot,
    mode,
    status,
    source,
    started_at,
    capture_at,
    completed_at,
    total_volume_kg,
    sets_snapshot
  )
  values (
    v_user_id,
    p_workout_date,
    p_routine_id,
    v_routine_name,
    'retroactive',
    'completed',
    'checkin',
    v_as_of,
    v_as_of,
    v_as_of,
    coalesce(v_total, 0),
    coalesce(v_snapshot, '[]'::jsonb)
  )
  returning * into v_inserted;

  insert into public.workout_attendance (user_id, attendance_date)
  values (v_user_id, p_workout_date)
  on conflict (user_id, attendance_date) do nothing;

  return next v_inserted;
end;
$$;

revoke all on function public.log_past_daily_workout(uuid, date) from public;
grant execute on function public.log_past_daily_workout(uuid, date) to authenticated;
