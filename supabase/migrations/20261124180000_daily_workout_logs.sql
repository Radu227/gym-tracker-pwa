-- Daily workout check-ins and frozen routine-set snapshots for accurate
-- weekly/monthly/muscle-group volume graphs without altering exercise set UI.

create table if not exists public.daily_workout_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workout_date date not null,
  routine_id uuid,
  routine_name_snapshot text not null,
  mode text not null check (mode in ('already_done', 'started_now', 'legacy_backfill')),
  status text not null check (status in ('in_progress', 'completed', 'cancelled')),
  source text not null default 'checkin' check (source in ('checkin', 'legacy_backfill')),
  started_at timestamptz not null default now(),
  capture_at timestamptz,
  completed_at timestamptz,
  total_volume_kg numeric(12, 2) not null default 0 check (total_volume_kg >= 0),
  sets_snapshot jsonb not null default '[]'::jsonb check (jsonb_typeof(sets_snapshot) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (routine_id, user_id)
    references public.routines (id, user_id) on delete set null (routine_id),
  check (
    (status = 'in_progress' and capture_at is not null and completed_at is null)
    or (status = 'completed' and completed_at is not null)
    or (status = 'cancelled')
  )
);

create index if not exists daily_workout_logs_user_date_idx
  on public.daily_workout_logs (user_id, workout_date desc);

create index if not exists daily_workout_logs_user_in_progress_idx
  on public.daily_workout_logs (user_id, capture_at)
  where status = 'in_progress';

create unique index if not exists daily_workout_logs_one_checkin_per_day_idx
  on public.daily_workout_logs (user_id, workout_date)
  where source = 'checkin' and status in ('in_progress', 'completed');

create unique index if not exists daily_workout_logs_legacy_backfill_idx
  on public.daily_workout_logs (user_id, workout_date, routine_id)
  where source = 'legacy_backfill';

drop trigger if exists daily_workout_logs_set_updated_at on public.daily_workout_logs;

create trigger daily_workout_logs_set_updated_at
before update on public.daily_workout_logs
for each row execute function public.set_updated_at();

alter table public.daily_workout_logs enable row level security;

drop policy if exists daily_workout_logs_select_own on public.daily_workout_logs;
create policy daily_workout_logs_select_own on public.daily_workout_logs
  for select to authenticated using (user_id = (select auth.uid()));

grant select on public.daily_workout_logs to authenticated;
grant all on public.daily_workout_logs to service_role;

create or replace function public.compute_routine_sets_snapshot(
  p_user_id uuid,
  p_routine_id uuid,
  p_as_of timestamptz
)
returns table (sets_snapshot jsonb, total_volume_kg numeric)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with routine_ex as (
    select distinct on (re.exercise_id)
      re.exercise_id,
      e.name as exercise_name,
      rmg.name as muscle_group,
      rmg.sort_order as group_sort,
      re.sort_order as ex_sort
    from public.routine_muscle_groups as rmg
    join public.routine_exercises as re
      on re.muscle_group_id = rmg.id
     and re.user_id = rmg.user_id
    join public.exercises as e
      on e.id = re.exercise_id
     and e.user_id = re.user_id
    where rmg.user_id = p_user_id
      and rmg.routine_id = p_routine_id
    order by re.exercise_id, rmg.sort_order asc, re.sort_order asc, re.created_at asc
  ),
  eligible_events as (
    select
      e.id,
      e.workout_set_id,
      e.supersedes_event_id,
      e.reps,
      e.weight_kg,
      e.is_voided,
      e.performed_at,
      e.created_at,
      s.exercise_id,
      s.set_number,
      sess.started_at as session_started_at
    from public.workout_set_events as e
    join public.workout_sets as s
      on s.id = e.workout_set_id
     and s.user_id = e.user_id
    join public.workout_sessions as sess
      on sess.id = s.session_id
     and sess.user_id = s.user_id
    join routine_ex as rx
      on rx.exercise_id = s.exercise_id
    where e.user_id = p_user_id
      and sess.status <> 'abandoned'
      and (
        (e.event_type = 'recorded' and least(e.performed_at, e.created_at) <= p_as_of)
        or (e.event_type in ('corrected', 'voided') and e.created_at <= p_as_of)
      )
  ),
  latest_event_per_set as (
    select e.*
    from eligible_events as e
    where not exists (
      select 1
      from eligible_events as succ
      where succ.supersedes_event_id = e.id
        and succ.workout_set_id = e.workout_set_id
    )
      and not e.is_voided
  ),
  latest_per_set_number as (
    select distinct on (le.exercise_id, le.set_number)
      le.exercise_id,
      rx.exercise_name,
      rx.muscle_group,
      rx.group_sort,
      rx.ex_sort,
      le.set_number,
      le.reps,
      le.weight_kg,
      round((le.weight_kg * le.reps)::numeric, 2) as volume_kg
    from latest_event_per_set as le
    join routine_ex as rx
      on rx.exercise_id = le.exercise_id
    order by
      le.exercise_id,
      le.set_number,
      le.session_started_at desc,
      le.performed_at desc,
      le.created_at desc
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'exercise_id', l.exercise_id,
          'exercise_name', l.exercise_name,
          'muscle_group', l.muscle_group,
          'set_number', l.set_number,
          'reps', l.reps,
          'weight_kg', l.weight_kg,
          'volume_kg', l.volume_kg
        )
        order by l.group_sort asc, l.ex_sort asc, l.exercise_name asc, l.set_number asc
      ),
      '[]'::jsonb
    ),
    coalesce(sum(l.volume_kg), 0)::numeric(12, 2)
  from latest_per_set_number as l;
end;
$$;

create or replace function public.finalize_due_daily_workouts()
returns setof public.daily_workout_logs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_log public.daily_workout_logs%rowtype;
  v_updated public.daily_workout_logs%rowtype;
  v_snapshot jsonb;
  v_total numeric(12, 2);
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  for v_log in
    select *
    from public.daily_workout_logs
    where user_id = v_user_id
      and status = 'in_progress'
      and capture_at <= now()
    order by capture_at asc
    for update
  loop
    if v_log.routine_id is not null then
      select s.sets_snapshot, s.total_volume_kg
        into v_snapshot, v_total
        from public.compute_routine_sets_snapshot(v_user_id, v_log.routine_id, v_log.capture_at) as s;
    else
      v_snapshot := '[]'::jsonb;
      v_total := 0;
    end if;

    update public.daily_workout_logs
       set status = 'completed',
           completed_at = v_log.capture_at,
           sets_snapshot = coalesce(v_snapshot, '[]'::jsonb),
           total_volume_kg = coalesce(v_total, 0)
     where id = v_log.id
    returning * into v_updated;

    return next v_updated;
  end loop;
end;
$$;

create or replace function public.log_daily_workout_now(
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
  v_routine_name text;
  v_snapshot jsonb;
  v_total numeric(12, 2);
  v_now timestamptz := now();
  v_inserted public.daily_workout_logs%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_routine_id is null or p_workout_date is null then
    raise exception 'Antrenamentul și data sunt obligatorii.';
  end if;

  perform public.finalize_due_daily_workouts();

  if exists (
    select 1
    from public.daily_workout_logs
    where user_id = v_user_id
      and status = 'in_progress'
  ) then
    raise exception 'Ai deja un antrenament în desfășurare.';
  end if;

  if exists (
    select 1
    from public.daily_workout_logs
    where user_id = v_user_id
      and workout_date = p_workout_date
      and source = 'checkin'
      and status in ('in_progress', 'completed')
  ) then
    raise exception 'Ai înregistrat deja un antrenament pentru astăzi.';
  end if;

  select r.name
    into v_routine_name
    from public.routines as r
   where r.id = p_routine_id
     and r.user_id = v_user_id;

  if not found then
    raise exception 'Antrenamentul selectat nu a fost găsit.';
  end if;

  select s.sets_snapshot, s.total_volume_kg
    into v_snapshot, v_total
    from public.compute_routine_sets_snapshot(v_user_id, p_routine_id, v_now) as s;

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
    'already_done',
    'completed',
    'checkin',
    v_now,
    v_now,
    v_now,
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

create or replace function public.start_daily_workout(
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
  v_routine_name text;
  v_now timestamptz := now();
  v_inserted public.daily_workout_logs%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_routine_id is null or p_workout_date is null then
    raise exception 'Antrenamentul și data sunt obligatorii.';
  end if;

  perform public.finalize_due_daily_workouts();

  if exists (
    select 1
    from public.daily_workout_logs
    where user_id = v_user_id
      and status = 'in_progress'
  ) then
    raise exception 'Ai deja un antrenament în desfășurare.';
  end if;

  if exists (
    select 1
    from public.daily_workout_logs
    where user_id = v_user_id
      and workout_date = p_workout_date
      and source = 'checkin'
      and status in ('in_progress', 'completed')
  ) then
    raise exception 'Ai înregistrat deja un antrenament pentru astăzi.';
  end if;

  select r.name
    into v_routine_name
    from public.routines as r
   where r.id = p_routine_id
     and r.user_id = v_user_id;

  if not found then
    raise exception 'Antrenamentul selectat nu a fost găsit.';
  end if;

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
    'started_now',
    'in_progress',
    'checkin',
    v_now,
    v_now + interval '3 hours',
    null,
    0,
    '[]'::jsonb
  )
  returning * into v_inserted;

  insert into public.workout_attendance (user_id, attendance_date)
  values (v_user_id, p_workout_date)
  on conflict (user_id, attendance_date) do nothing;

  return next v_inserted;
end;
$$;

create or replace function public.finalize_daily_workout(p_log_id uuid)
returns setof public.daily_workout_logs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_log public.daily_workout_logs%rowtype;
  v_updated public.daily_workout_logs%rowtype;
  v_as_of timestamptz;
  v_snapshot jsonb;
  v_total numeric(12, 2);
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
    into v_log
    from public.daily_workout_logs
   where id = p_log_id
     and user_id = v_user_id
   for update;

  if not found then
    raise exception 'Antrenamentul nu a fost găsit.';
  end if;

  if v_log.status = 'completed' then
    return next v_log;
    return;
  end if;

  if v_log.status <> 'in_progress' then
    raise exception 'Antrenamentul nu poate fi finalizat.';
  end if;

  v_as_of := least(now(), v_log.capture_at);

  if v_log.routine_id is not null then
    select s.sets_snapshot, s.total_volume_kg
      into v_snapshot, v_total
      from public.compute_routine_sets_snapshot(v_user_id, v_log.routine_id, v_as_of) as s;
  else
    v_snapshot := '[]'::jsonb;
    v_total := 0;
  end if;

  update public.daily_workout_logs
     set status = 'completed',
         completed_at = v_as_of,
         sets_snapshot = coalesce(v_snapshot, '[]'::jsonb),
         total_volume_kg = coalesce(v_total, 0)
   where id = v_log.id
  returning * into v_updated;

  return next v_updated;
end;
$$;

create or replace function public.cancel_daily_workout(p_log_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_log public.daily_workout_logs%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
    into v_log
    from public.daily_workout_logs
   where id = p_log_id
     and user_id = v_user_id
   for update;

  if not found then
    raise exception 'Antrenamentul nu a fost găsit.';
  end if;

  if v_log.status <> 'in_progress' then
    raise exception 'Doar antrenamentul în desfășurare poate fi anulat.';
  end if;

  update public.daily_workout_logs
     set status = 'cancelled'
   where id = v_log.id;

  delete from public.workout_attendance
   where user_id = v_user_id
     and attendance_date = v_log.workout_date;
end;
$$;

revoke all on function public.compute_routine_sets_snapshot(uuid, uuid, timestamptz) from public;
revoke all on function public.finalize_due_daily_workouts() from public;
revoke all on function public.log_daily_workout_now(uuid, date) from public;
revoke all on function public.start_daily_workout(uuid, date) from public;
revoke all on function public.finalize_daily_workout(uuid) from public;
revoke all on function public.cancel_daily_workout(uuid) from public;

grant execute on function public.finalize_due_daily_workouts() to authenticated;
grant execute on function public.log_daily_workout_now(uuid, date) to authenticated;
grant execute on function public.start_daily_workout(uuid, date) to authenticated;
grant execute on function public.finalize_daily_workout(uuid) to authenticated;
grant execute on function public.cancel_daily_workout(uuid) to authenticated;

-- One-time backfill for last week (up to Sunday 23:59:59.999999 Europe/Bucharest),
-- freezing each routine's latest active set per exercise/set_number before this week's edits.
do $$
declare
  v_current_week_start timestamptz :=
    date_trunc('week', now() at time zone 'Europe/Bucharest') at time zone 'Europe/Bucharest';
  v_last_week_cutoff timestamptz := v_current_week_start - interval '1 microsecond';
  v_last_week_sunday date := (date_trunc('week', now() at time zone 'Europe/Bucharest')::date - 1);
  v_routine record;
  v_snapshot jsonb;
  v_total numeric(12, 2);
begin
  for v_routine in
    select id, user_id, name
    from public.routines
  loop
    select s.sets_snapshot, s.total_volume_kg
      into v_snapshot, v_total
      from public.compute_routine_sets_snapshot(v_routine.user_id, v_routine.id, v_last_week_cutoff) as s;

    if jsonb_array_length(coalesce(v_snapshot, '[]'::jsonb)) > 0 then
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
        v_routine.user_id,
        v_last_week_sunday,
        v_routine.id,
        v_routine.name,
        'legacy_backfill',
        'completed',
        'legacy_backfill',
        v_last_week_cutoff,
        v_last_week_cutoff,
        v_last_week_cutoff,
        coalesce(v_total, 0),
        v_snapshot
      )
      on conflict (user_id, workout_date, routine_id) where source = 'legacy_backfill' do nothing;
    end if;
  end loop;
end;
$$;
