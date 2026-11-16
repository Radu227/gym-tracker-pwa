do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'workout_sessions_routine_id_user_id_fkey'
      and conrelid = 'public.workout_sessions'::regclass
  ) then
    alter table public.workout_sessions
      drop constraint workout_sessions_routine_id_user_id_fkey;
  end if;
end
$$;

alter table public.workout_sessions
  add constraint workout_sessions_routine_id_user_id_fkey
  foreign key (routine_id, user_id)
  references public.routines (id, user_id)
  on delete set null (routine_id);
