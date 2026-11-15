-- Attendance is independent from workout sets, so a user can record a gym
-- visit even when no exercise values were changed.

create table if not exists public.workout_attendance (
  user_id uuid not null references auth.users (id) on delete cascade,
  attendance_date date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, attendance_date)
);

alter table public.workout_attendance enable row level security;

drop policy if exists workout_attendance_select_own on public.workout_attendance;
create policy workout_attendance_select_own on public.workout_attendance
  for select using (auth.uid() = user_id);

drop policy if exists workout_attendance_insert_own on public.workout_attendance;
create policy workout_attendance_insert_own on public.workout_attendance
  for insert with check (auth.uid() = user_id);

grant select, insert on public.workout_attendance to authenticated;

drop trigger if exists workout_attendance_weekly_achievements on public.workout_attendance;

create trigger workout_attendance_weekly_achievements
after insert on public.workout_attendance
for each row execute function public.refresh_weekly_achievement_progress();
