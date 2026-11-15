create table if not exists public.exercise_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  exercise_id uuid not null,
  target_weight_kg numeric(7, 2) not null check (target_weight_kg > 0),
  target_reps smallint not null check (target_reps between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (exercise_id, user_id)
    references public.exercises (id, user_id) on delete cascade
);

create index if not exists exercise_goals_user_idx
  on public.exercise_goals (user_id, created_at desc);

alter table public.exercise_goals enable row level security;

drop policy if exists exercise_goals_own on public.exercise_goals;
create policy exercise_goals_own on public.exercise_goals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.exercise_goals to authenticated;
