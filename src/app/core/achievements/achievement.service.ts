import { inject, Injectable } from '@angular/core';

import { SupabaseClientService } from '../supabase/supabase-client.service';

export interface Achievement {
  code: string;
  title: string;
  description: string;
  progress: number;
  target: number;
  unlockedAt: string | null;
}

@Injectable({ providedIn: 'root' })
export class AchievementService {
  private readonly supabase = inject(SupabaseClientService);

  async listForUser(userId: string): Promise<Achievement[]> {
    const [
      { data: definitions, error: definitionsError },
      { data: progress, error: progressError },
      { data: weeklySets, error: weeklySetsError },
      { data: weeklyAttendance, error: weeklyAttendanceError },
    ] = await Promise.all([
      this.supabase.client
        .from('achievement_definitions')
        .select('code,title,description,criteria')
        .eq('is_active', true)
        .order('created_at', { ascending: true }),
      this.supabase.client
        .from('user_achievements')
        .select('achievement_code,progress,target,unlocked_at')
        .eq('user_id', userId),
      this.supabase.client
        .from('workout_set_current')
        .select('performed_at')
        .eq('user_id', userId)
        .eq('is_voided', false)
        .gte('performed_at', getLocalWeekStart().toISOString()),
      this.supabase.client
        .from('workout_attendance')
        .select('attendance_date')
        .eq('user_id', userId)
        .gte('attendance_date', toLocalDateKey(getLocalWeekStart())),
    ]);

    if (definitionsError) {
      throw definitionsError;
    }
    if (progressError) {
      throw progressError;
    }
    if (weeklySetsError) {
      throw weeklySetsError;
    }
    if (weeklyAttendanceError) {
      throw weeklyAttendanceError;
    }

    const progressByCode = new Map(
      (progress ?? []).map((item) => [
        item.achievement_code,
        { progress: Number(item.progress), target: Number(item.target), unlockedAt: item.unlocked_at },
      ]),
    );
    const weeklyDays = new Set([
      ...(weeklySets ?? []).map((set) => toLocalDateKey(new Date(set.performed_at))),
      ...(weeklyAttendance ?? []).map((item) => item.attendance_date),
    ]).size;

    const achievements = (definitions ?? []).map((definition) => {
      const current = progressByCode.get(definition.code);
      const target = current?.target ?? inferTarget(definition.criteria);
      const weeklyTarget = weeklyTargetForCode(definition.code);
      const progressValue = weeklyTarget ? Math.min(weeklyDays, weeklyTarget) : (current?.progress ?? 0);
      return {
        code: definition.code,
        title: definition.title,
        description: definition.description,
        progress: Math.min(progressValue, target),
        target: weeklyTarget ?? target,
        unlockedAt: weeklyTarget && weeklyDays < weeklyTarget ? null : (current?.unlockedAt ?? null),
      };
    });

    return achievements.sort((left, right) => {
      const leftUnlocked = left.unlockedAt !== null;
      const rightUnlocked = right.unlockedAt !== null;
      if (leftUnlocked !== rightUnlocked) {
        return leftUnlocked ? 1 : -1;
      }
      if (!leftUnlocked && !rightUnlocked) {
        return right.progress / right.target - left.progress / left.target;
      }
      return (right.unlockedAt ?? '').localeCompare(left.unlockedAt ?? '');
    });
  }
}

function weeklyTargetForCode(code: string): number | null {
  return (
    { weekly_three_days: 3, weekly_five_days: 5, weekly_seven_days: 7 }[
      code as 'weekly_three_days' | 'weekly_five_days' | 'weekly_seven_days'
    ] ?? null
  );
}

function getLocalWeekStart(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
}

function toLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function inferTarget(criteria: unknown): number {
  if (typeof criteria !== 'object' || criteria === null) {
    return 1;
  }
  const values = Object.values(criteria);
  const numericTarget = values.find((value) => typeof value === 'number' && value > 0);
  return typeof numericTarget === 'number' ? numericTarget : 1;
}
