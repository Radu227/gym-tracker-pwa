-- Initial Supabase schema for the gym-tracking PWA.
-- Run once in the Supabase SQL editor (PostgreSQL 15+).

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  first_name text,
  last_name text,
  avatar_style text check (avatar_style in ('male', 'female')),
  age smallint check (age between 13 and 120),
  weight_kg numeric(6, 2) check (weight_kg > 0),
  height_cm numeric(5, 2) check (height_cm > 0),
  weekly_goal smallint not null default 3 check (weekly_goal between 1 and 7),
  fitness_goal text check (fitness_goal in ('hypertrophy', 'strength', 'fat_loss', 'maintenance')),
  experience_level text check (experience_level in ('beginner', 'intermediate', 'advanced')),
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  notes text,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create index routines_user_order_idx
  on public.routines (user_id, sort_order, created_at);

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  primary_muscle_group text not null check (length(btrim(primary_muscle_group)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create unique index exercises_user_name_idx
  on public.exercises (user_id, lower(name));

create table public.routine_muscle_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  routine_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 80),
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (routine_id, user_id)
    references public.routines (id, user_id) on delete cascade
);

create index routine_muscle_groups_order_idx
  on public.routine_muscle_groups (user_id, routine_id, sort_order);

create table public.routine_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  muscle_group_id uuid not null,
  exercise_id uuid not null,
  sort_order smallint not null default 0,
  target_sets smallint check (target_sets between 1 and 30),
  target_reps_min smallint check (target_reps_min between 1 and 1000),
  target_reps_max smallint check (target_reps_max between 1 and 1000),
  created_at timestamptz not null default now(),
  check (target_reps_min is null or target_reps_max is null or target_reps_min <= target_reps_max),
  foreign key (muscle_group_id, user_id)
    references public.routine_muscle_groups (id, user_id) on delete cascade,
  foreign key (exercise_id, user_id)
    references public.exercises (id, user_id) on delete restrict
);

create index routine_exercises_order_idx
  on public.routine_exercises (user_id, muscle_group_id, sort_order);

create table public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  routine_id uuid,
  routine_name_snapshot text,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'abandoned')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  check (
    (status = 'completed' and completed_at is not null)
    or (status in ('in_progress', 'abandoned') and completed_at is null)
  ),
  foreign key (routine_id, user_id)
    references public.routines (id, user_id) on delete restrict
);

create index workout_sessions_user_started_idx
  on public.workout_sessions (user_id, started_at desc);

create index workout_sessions_routine_idx
  on public.workout_sessions (user_id, routine_id, started_at desc)
  where routine_id is not null;

-- A set is the stable identity for one performed set. Its values are stored as
-- append-only events below so a correction never overwrites the original.
create table public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null,
  exercise_id uuid not null,
  set_number smallint not null check (set_number between 1 and 100),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (session_id, user_id)
    references public.workout_sessions (id, user_id) on delete cascade,
  foreign key (exercise_id, user_id)
    references public.exercises (id, user_id) on delete restrict
);

create index workout_sets_session_idx
  on public.workout_sets (user_id, session_id, exercise_id, set_number);

create table public.workout_set_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workout_set_id uuid not null,
  event_type text not null check (event_type in ('recorded', 'corrected', 'voided')),
  supersedes_event_id uuid,
  reps smallint not null check (reps between 1 and 1000),
  weight_kg numeric(7, 2) not null check (weight_kg >= 0),
  is_failure boolean not null default false,
  is_voided boolean not null default false,
  notes text check (notes is null or length(notes) <= 2000),
  performed_at timestamptz not null default now(),
  client_mutation_id uuid not null,
  created_at timestamptz not null default now(),
  unique (id, workout_set_id, user_id),
  unique (user_id, client_mutation_id),
  check (
    (event_type = 'recorded' and supersedes_event_id is null and not is_voided)
    or (event_type = 'corrected' and supersedes_event_id is not null and not is_voided)
    or (event_type = 'voided' and supersedes_event_id is not null and is_voided)
  ),
  foreign key (workout_set_id, user_id)
    references public.workout_sets (id, user_id) on delete cascade,
  foreign key (supersedes_event_id, workout_set_id, user_id)
    references public.workout_set_events (id, workout_set_id, user_id) on delete restrict
);

create unique index workout_set_events_one_initial_idx
  on public.workout_set_events (workout_set_id)
  where event_type = 'recorded';

create unique index workout_set_events_one_successor_idx
  on public.workout_set_events (supersedes_event_id)
  where supersedes_event_id is not null;

create index workout_set_events_user_performed_idx
  on public.workout_set_events (user_id, performed_at desc);

create index workout_set_events_set_created_idx
  on public.workout_set_events (workout_set_id, created_at desc);

create or replace view public.workout_set_current
with (security_invoker = true)
as
select
  s.id as workout_set_id,
  s.user_id,
  s.session_id,
  s.exercise_id,
  s.set_number,
  e.id as current_event_id,
  e.event_type,
  e.reps,
  e.weight_kg,
  e.is_failure,
  e.is_voided,
  e.notes,
  e.performed_at,
  e.created_at
from public.workout_sets as s
join public.workout_set_events as e
  on e.workout_set_id = s.id
 and e.user_id = s.user_id
where not exists (
  select 1
  from public.workout_set_events as successor
  where successor.supersedes_event_id = e.id
    and successor.workout_set_id = s.id
    and successor.user_id = s.user_id
);

create table public.achievement_definitions (
  code text primary key,
  title text not null,
  description text not null,
  criteria jsonb not null default '{}'::jsonb check (jsonb_typeof(criteria) = 'object'),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.achievement_definitions (code, title, description, criteria)
values
  ('weekly_goal_streak_4', 'Patru săptămâni consecvente',
   'Atinge ținta săptămânală patru săptămâni la rând.',
   '{"type":"weekly_goal_streak","weeks":4}'::jsonb),
  ('first_personal_record', 'Primul record personal',
   'Obține primul record personal nou.',
   '{"type":"personal_record","count":1}'::jsonb),
  ('workouts_10', 'Zece antrenamente',
   'Finalizează zece antrenamente.',
   '{"type":"completed_workouts","count":10}'::jsonb),
  ('session_volume_10000', 'Zece tone într-o sesiune',
   'Ridică un volum cumulat de 10.000 kg într-o sesiune.',
   '{"type":"session_volume_kg","value":10000}'::jsonb)
on conflict (code) do nothing;

create table public.user_achievements (
  user_id uuid not null references auth.users (id) on delete cascade,
  achievement_code text not null references public.achievement_definitions (code) on delete restrict,
  progress numeric(12, 2) not null default 0 check (progress >= 0),
  target numeric(12, 2) not null check (target > 0),
  unlocked_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, achievement_code)
);

create table public.notification_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  inactivity_reminders boolean not null default true,
  achievement_alerts boolean not null default true,
  push_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null,
  p256dh_key text not null,
  auth_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category text not null check (category in ('encouragement', 'achievement', 'system')),
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where read_at is null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger routines_set_updated_at
before update on public.routines
for each row execute function public.set_updated_at();

create trigger exercises_set_updated_at
before update on public.exercises
for each row execute function public.set_updated_at();

create trigger notification_preferences_set_updated_at
before update on public.notification_preferences
for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id) values (new.id);
  insert into public.notification_preferences (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- Backfill accounts that existed before this migration was run.
insert into public.profiles (user_id)
select u.id from auth.users as u
on conflict (user_id) do nothing;

insert into public.notification_preferences (user_id)
select u.id from auth.users as u
on conflict (user_id) do nothing;

-- Append one completed set. The client supplies a stable mutation UUID so an
-- offline sync retry returns the original result instead of duplicating a set.
create or replace function public.record_workout_set(
  p_session_id uuid,
  p_exercise_id uuid,
  p_set_number smallint,
  p_reps smallint,
  p_weight_kg numeric,
  p_is_failure boolean,
  p_notes text,
  p_performed_at timestamptz,
  p_client_mutation_id uuid
)
returns table (workout_set_id uuid, event_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_workout_set_id uuid;
  v_event_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_client_mutation_id is null then
    raise exception 'A client mutation ID is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':' || p_client_mutation_id::text, 0)
  );

  select e.workout_set_id, e.id
    into v_workout_set_id, v_event_id
    from public.workout_set_events as e
   where e.user_id = v_user_id
     and e.client_mutation_id = p_client_mutation_id;

  if found then
    return query select v_workout_set_id, v_event_id;
    return;
  end if;

  if not exists (
    select 1
      from public.workout_sessions as s
     where s.id = p_session_id
       and s.user_id = v_user_id
       and s.status <> 'abandoned'
  ) then
    raise exception 'Workout session not found or unavailable';
  end if;

  if not exists (
    select 1
      from public.exercises as e
     where e.id = p_exercise_id
       and e.user_id = v_user_id
  ) then
    raise exception 'Exercise not found';
  end if;

  insert into public.workout_sets (user_id, session_id, exercise_id, set_number)
  values (v_user_id, p_session_id, p_exercise_id, p_set_number)
  returning id into v_workout_set_id;

  insert into public.workout_set_events (
    user_id, workout_set_id, event_type, reps, weight_kg, is_failure,
    is_voided, notes, performed_at, client_mutation_id
  )
  values (
    v_user_id, v_workout_set_id, 'recorded', p_reps, p_weight_kg, p_is_failure,
    false, p_notes, p_performed_at, p_client_mutation_id
  )
  returning id into v_event_id;

  return query select v_workout_set_id, v_event_id;
end;
$$;

-- Append a correction or void event. The current event and set identity remain
-- untouched; the unique successor index prevents correction history branching.
create or replace function public.correct_workout_set(
  p_workout_set_id uuid,
  p_previous_event_id uuid,
  p_event_type text,
  p_reps smallint,
  p_weight_kg numeric,
  p_is_failure boolean,
  p_notes text,
  p_client_mutation_id uuid
)
returns table (workout_set_id uuid, event_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_locked_set_id uuid;
  v_existing_set_id uuid;
  v_event_id uuid;
  v_reps smallint;
  v_weight_kg numeric(7, 2);
  v_is_failure boolean;
  v_notes text;
  v_performed_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_client_mutation_id is null then
    raise exception 'A client mutation ID is required';
  end if;
  if p_event_type is null or p_event_type not in ('corrected', 'voided') then
    raise exception 'Event type must be corrected or voided';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':' || p_client_mutation_id::text, 0)
  );

  select e.workout_set_id, e.id
    into v_existing_set_id, v_event_id
    from public.workout_set_events as e
   where e.user_id = v_user_id
     and e.client_mutation_id = p_client_mutation_id;

  if found then
    if v_existing_set_id <> p_workout_set_id then
      raise exception 'Client mutation ID was already used for another set';
    end if;
    return query select v_existing_set_id, v_event_id;
    return;
  end if;

  select s.id
    into v_locked_set_id
    from public.workout_sets as s
   where s.id = p_workout_set_id
     and s.user_id = v_user_id
   for update;

  if not found then
    raise exception 'Workout set not found';
  end if;

  select e.reps, e.weight_kg, e.is_failure, e.notes, e.performed_at
    into v_reps, v_weight_kg, v_is_failure, v_notes, v_performed_at
    from public.workout_set_events as e
   where e.id = p_previous_event_id
     and e.workout_set_id = p_workout_set_id
     and e.user_id = v_user_id;

  if not found then
    raise exception 'Previous set event not found';
  end if;

  if exists (
    select 1
      from public.workout_set_events as child
     where child.supersedes_event_id = p_previous_event_id
  ) then
    raise exception 'Only the latest set event can be corrected';
  end if;

  if p_event_type = 'corrected' then
    if p_reps is null or p_weight_kg is null or p_is_failure is null then
      raise exception 'A correction requires reps, weight, and failure status';
    end if;
    v_reps := p_reps;
    v_weight_kg := p_weight_kg;
    v_is_failure := p_is_failure;
    v_notes := p_notes;
  end if;

  insert into public.workout_set_events (
    user_id, workout_set_id, event_type, supersedes_event_id, reps, weight_kg,
    is_failure, is_voided, notes, performed_at, client_mutation_id
  )
  values (
    v_user_id, p_workout_set_id, p_event_type, p_previous_event_id, v_reps, v_weight_kg,
    v_is_failure, (p_event_type = 'voided'), v_notes, v_performed_at, p_client_mutation_id
  )
  returning id into v_event_id;

  return query select p_workout_set_id, v_event_id;
end;
$$;

-- RLS is enabled on every application table in this schema.
alter table public.profiles enable row level security;
alter table public.routines enable row level security;
alter table public.exercises enable row level security;
alter table public.routine_muscle_groups enable row level security;
alter table public.routine_exercises enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.workout_sets enable row level security;
alter table public.workout_set_events enable row level security;
alter table public.achievement_definitions enable row level security;
alter table public.user_achievements enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notifications enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated using (user_id = (select auth.uid()));
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy routines_own on public.routines
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy exercises_own on public.exercises
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy routine_muscle_groups_own on public.routine_muscle_groups
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy routine_exercises_own on public.routine_exercises
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy workout_sessions_select_own on public.workout_sessions
  for select to authenticated using (user_id = (select auth.uid()));
create policy workout_sessions_insert_own on public.workout_sessions
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy workout_sessions_update_own on public.workout_sessions
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy workout_sets_select_own on public.workout_sets
  for select to authenticated using (user_id = (select auth.uid()));
create policy workout_set_events_select_own on public.workout_set_events
  for select to authenticated using (user_id = (select auth.uid()));

create policy achievement_definitions_read on public.achievement_definitions
  for select to authenticated using (is_active);
create policy user_achievements_select_own on public.user_achievements
  for select to authenticated using (user_id = (select auth.uid()));

create policy notification_preferences_own on public.notification_preferences
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy push_subscriptions_own on public.push_subscriptions
  for all to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy notifications_select_own on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_update_read_own on public.notifications
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant usage on schema public to authenticated, service_role;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on
  public.routines,
  public.exercises,
  public.routine_muscle_groups,
  public.routine_exercises
  to authenticated;
grant select, insert, update on public.workout_sessions to authenticated;
grant select on public.workout_sets, public.workout_set_events to authenticated;
grant select on public.workout_set_current to authenticated;
grant select on public.achievement_definitions, public.user_achievements to authenticated;
grant select, insert, update on public.notification_preferences to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

grant all on
  public.profiles,
  public.routines,
  public.exercises,
  public.routine_muscle_groups,
  public.routine_exercises,
  public.workout_sessions,
  public.workout_sets,
  public.workout_set_events,
  public.workout_set_current,
  public.achievement_definitions,
  public.user_achievements,
  public.notification_preferences,
  public.push_subscriptions,
  public.notifications
  to service_role;

revoke all on function public.set_updated_at() from public;
revoke all on function public.handle_new_auth_user() from public;
revoke all on function public.record_workout_set(
  uuid, uuid, smallint, smallint, numeric, boolean, text, timestamptz, uuid
) from public;
revoke all on function public.correct_workout_set(
  uuid, uuid, text, smallint, numeric, boolean, text, uuid
) from public;

grant execute on function public.record_workout_set(
  uuid, uuid, smallint, smallint, numeric, boolean, text, timestamptz, uuid
) to authenticated;
grant execute on function public.correct_workout_set(
  uuid, uuid, text, smallint, numeric, boolean, text, uuid
) to authenticated;
