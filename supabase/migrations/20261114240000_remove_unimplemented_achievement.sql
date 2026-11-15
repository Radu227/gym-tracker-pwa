-- This achievement depended on a removed workout-finalization flow.
update public.achievement_definitions
set is_active = false
where code = 'workouts_10';

delete from public.user_achievements
where achievement_code = 'workouts_10';
