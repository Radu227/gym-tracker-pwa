import { inject, Injectable } from '@angular/core';

import { WorkoutLocalStore } from '../offline/workout-local-store';
import { SupabaseClientService } from '../supabase/supabase-client.service';

export interface ProgressStatistics {
  totalVolume: number;
  monthlyWorkouts: number;
  currentStreak: number;
  progressingExercises: number;
}

interface StatisticSet {
  id: string;
  exerciseId: string;
  reps: number;
  weightKg: number;
  performedAt: string;
}

@Injectable({ providedIn: 'root' })
export class ProgressService {
  private readonly supabase = inject(SupabaseClientService);
  private readonly localStore = inject(WorkoutLocalStore);

  async listWorkoutDates(userId: string, month: Date): Promise<Set<string>> {
    const start = new Date(month.getFullYear(), month.getMonth(), 1);
    const end = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    const [{ data: sets, error: setsError }, { data: attendance, error: attendanceError }] = await Promise.all([
      this.supabase.client
        .from('workout_set_current')
        .select('performed_at')
        .eq('user_id', userId)
        .eq('is_voided', false)
        .gte('performed_at', start.toISOString())
        .lt('performed_at', end.toISOString()),
      this.supabase.client
        .from('workout_attendance')
        .select('attendance_date')
        .eq('user_id', userId)
        .gte('attendance_date', toDateKey(start))
        .lt('attendance_date', toDateKey(end)),
    ]);

    if (setsError) {
      throw setsError;
    }
    if (attendanceError) {
      throw attendanceError;
    }

    return new Set([
      ...(sets ?? []).map((row) => toDateKey(new Date(row.performed_at))),
      ...(attendance ?? []).map((row) => row.attendance_date),
    ]);
  }

  async hasWorkoutToday(userId: string): Promise<boolean> {
    const dates = await this.listWorkoutDates(userId, new Date());
    return dates.has(toDateKey(new Date()));
  }

  async markAttendance(userId: string, date = new Date()): Promise<void> {
    const { error } = await this.supabase.client
      .from('workout_attendance')
      .upsert(
        { user_id: userId, attendance_date: toDateKey(date) },
        { onConflict: 'user_id,attendance_date', ignoreDuplicates: true },
      );

    if (error) {
      throw error;
    }
  }

  async getStatistics(userId: string): Promise<ProgressStatistics> {
    const [{ data: remoteSets, error }, { data: attendance, error: attendanceError }, pending] = await Promise.all([
      this.supabase.client
        .from('workout_set_current')
        .select('workout_set_id,exercise_id,reps,weight_kg,performed_at')
        .eq('user_id', userId)
        .eq('is_voided', false)
        .limit(5000),
      this.supabase.client.from('workout_attendance').select('attendance_date').eq('user_id', userId),
      this.localStore.getPendingSets(userId),
    ]);

    if (error) {
      throw error;
    }
    if (attendanceError) {
      throw attendanceError;
    }

    const remoteIds = new Set((remoteSets ?? []).map((set) => set.workout_set_id));
    const sets: StatisticSet[] = [
      ...(remoteSets ?? []).map((set) => ({
        id: set.workout_set_id,
        exerciseId: set.exercise_id,
        reps: Number(set.reps),
        weightKg: Number(set.weight_kg),
        performedAt: set.performed_at,
      })),
      ...pending
        .filter((item) => !remoteIds.has(item.set.id))
        .map((item) => ({
          id: item.set.id,
          exerciseId: item.set.exerciseId,
          reps: item.set.reps,
          weightKg: item.set.weightKg,
          performedAt: item.set.performedAt,
        })),
    ];

    const today = new Date();
    const todayKey = toDateKey(today);
    const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 7);
    let totalVolume = 0;
    const dates = new Set<string>();
    const monthlyDates = new Set((attendance ?? []).map((item) => item.attendance_date));
    const recentMax = new Map<string, number>();
    const previousMax = new Map<string, number>();

    for (const set of sets) {
      const date = new Date(set.performedAt);
      const dateKey = toDateKey(date);
      const volume = set.weightKg * set.reps;
      dates.add(dateKey);
      if (dateKey.startsWith(monthKey)) {
        monthlyDates.add(dateKey);
      }

      for (const attendanceItem of attendance ?? []) {
        dates.add(attendanceItem.attendance_date);
        if (attendanceItem.attendance_date.startsWith(monthKey)) {
          monthlyDates.add(attendanceItem.attendance_date);
        }
      }
      if (date >= sevenDaysAgo) {
        recentMax.set(set.exerciseId, Math.max(recentMax.get(set.exerciseId) ?? 0, set.weightKg));
      } else {
        previousMax.set(set.exerciseId, Math.max(previousMax.get(set.exerciseId) ?? 0, set.weightKg));
      }
      totalVolume += volume;
    }

    return {
      totalVolume,
      monthlyWorkouts: monthlyDates.size,
      currentStreak: calculateStreak(dates, todayKey),
      progressingExercises: [...recentMax.entries()].filter(
        ([exerciseId, weight]) => weight > (previousMax.get(exerciseId) ?? 0),
      ).length,
    };
  }
}

function calculateStreak(dates: Set<string>, todayKey: string): number {
  if (!dates.has(todayKey)) {
    return 0;
  }
  let streak = 0;
  const date = new Date(`${todayKey}T12:00:00`);
  while (dates.has(toDateKey(date))) {
    streak += 1;
    date.setDate(date.getDate() - 1);
  }
  return streak;
}

export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
