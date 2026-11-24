import { inject, Injectable } from '@angular/core';

import { toDateKey } from '../progress/progress.service';
import { SupabaseClientService } from '../supabase/supabase-client.service';
import { WorkoutSyncService } from '../sync/workout-sync.service';

export interface DailyWorkoutSetSnapshot {
  exercise_id: string;
  exercise_name: string;
  muscle_group: string;
  set_number: number;
  reps: number;
  weight_kg: number;
  volume_kg: number;
}

export interface DailyWorkoutLog {
  id: string;
  user_id: string;
  workout_date: string;
  routine_id: string | null;
  routine_name_snapshot: string;
  mode: 'already_done' | 'started_now' | 'retroactive' | 'legacy_backfill';
  status: 'in_progress' | 'completed' | 'cancelled';
  source: 'checkin' | 'legacy_backfill';
  started_at: string;
  capture_at: string | null;
  completed_at: string | null;
  total_volume_kg: number;
  sets_snapshot: DailyWorkoutSetSnapshot[];
  created_at: string;
  updated_at: string;
}

export interface TodayWorkoutState {
  activeLog: DailyWorkoutLog | null;
  completedToday: DailyWorkoutLog | null;
}

const LOG_COLUMNS =
  'id,user_id,workout_date,routine_id,routine_name_snapshot,mode,status,source,started_at,capture_at,completed_at,total_volume_kg,sets_snapshot,created_at,updated_at';
const PAGE_SIZE = 1000;

@Injectable({ providedIn: 'root' })
export class DailyWorkoutService {
  private readonly supabase = inject(SupabaseClientService);
  private readonly sync = inject(WorkoutSyncService);

  async finalizeDueWorkouts(): Promise<DailyWorkoutLog[]> {
    await this.syncPendingBestEffort();
    const { data, error } = await this.supabase.client.rpc('finalize_due_daily_workouts');
    if (error) {
      throw error;
    }
    return normalizeLogList(data);
  }

  async getTodayState(userId: string, todayDateKey = toDateKey(new Date())): Promise<TodayWorkoutState> {
    await this.finalizeDueWorkouts();

    const [{ data: activeData, error: activeError }, { data: completedData, error: completedError }] =
      await Promise.all([
        this.supabase.client
          .from('daily_workout_logs')
          .select(LOG_COLUMNS)
          .eq('user_id', userId)
          .eq('status', 'in_progress')
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        this.supabase.client
          .from('daily_workout_logs')
          .select(LOG_COLUMNS)
          .eq('user_id', userId)
          .eq('source', 'checkin')
          .eq('status', 'completed')
          .eq('workout_date', todayDateKey)
          .limit(1)
          .maybeSingle(),
      ]);

    if (activeError) {
      throw activeError;
    }
    if (completedError) {
      throw completedError;
    }

    return {
      activeLog: activeData ? normalizeLog(activeData) : null,
      completedToday: completedData ? normalizeLog(completedData) : null,
    };
  }

  async logCompletedNow(routineId: string, workoutDate = toDateKey(new Date())): Promise<DailyWorkoutLog> {
    await this.syncPendingBestEffort();
    const { data, error } = await this.supabase.client.rpc('log_daily_workout_now', {
      p_routine_id: routineId,
      p_workout_date: workoutDate,
    });
    if (error) {
      throw error;
    }
    return parseSingleLog(data, 'Antrenamentul nu a putut fi înregistrat.');
  }

  async logPastWorkout(routineId: string, workoutDate: string): Promise<DailyWorkoutLog> {
    await this.syncPendingBestEffort();
    const { data, error } = await this.supabase.client.rpc('log_past_daily_workout', {
      p_routine_id: routineId,
      p_workout_date: workoutDate,
    });
    if (error) {
      throw error;
    }
    return parseSingleLog(data, 'Antrenamentul nu a putut fi înregistrat.');
  }

  async startWorkout(routineId: string, workoutDate = toDateKey(new Date())): Promise<DailyWorkoutLog> {
    const { data, error } = await this.supabase.client.rpc('start_daily_workout', {
      p_routine_id: routineId,
      p_workout_date: workoutDate,
    });
    if (error) {
      throw error;
    }
    return parseSingleLog(data, 'Antrenamentul nu a putut fi pornit.');
  }

  async finalizeWorkout(logId: string): Promise<DailyWorkoutLog> {
    await this.syncPendingBestEffort();
    const { data, error } = await this.supabase.client.rpc('finalize_daily_workout', {
      p_log_id: logId,
    });
    if (error) {
      throw error;
    }
    return parseSingleLog(data, 'Antrenamentul nu a putut fi finalizat.');
  }

  async cancelWorkout(logId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('cancel_daily_workout', {
      p_log_id: logId,
    });
    if (error) {
      throw error;
    }
  }

  async listCompletedLogs(userId: string): Promise<DailyWorkoutLog[]> {
    await this.finalizeDueWorkouts();

    const logs: DailyWorkoutLog[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await this.supabase.client
        .from('daily_workout_logs')
        .select(LOG_COLUMNS)
        .eq('user_id', userId)
        .eq('status', 'completed')
        .order('workout_date', { ascending: true })
        .order('created_at', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        throw error;
      }

      const batch = normalizeLogList(data);
      logs.push(...batch);
      if (batch.length < PAGE_SIZE) {
        break;
      }
    }

    return logs;
  }

  private async syncPendingBestEffort(): Promise<void> {
    if (typeof navigator === 'undefined' || navigator.onLine) {
      await this.sync.syncNow().catch(() => undefined);
    }
  }
}

export function formatCountdown(remainingMs: number): string {
  const totalSeconds = remainingMs <= 0 ? 0 : Math.ceil(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

function parseSingleLog(value: unknown, fallbackError: string): DailyWorkoutLog {
  const logs = normalizeLogList(value);
  if (logs.length !== 1) {
    throw new Error(fallbackError);
  }
  return logs[0];
}

function normalizeLogList(value: unknown): DailyWorkoutLog[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => normalizeLog(item as Record<string, unknown>));
}

function normalizeLog(row: Record<string, unknown>): DailyWorkoutLog {
  const rawSnapshot = Array.isArray(row['sets_snapshot']) ? row['sets_snapshot'] : [];
  const setsSnapshot: DailyWorkoutSetSnapshot[] = rawSnapshot.map((entry) => {
    const item = entry as Record<string, unknown>;
    return {
      exercise_id: String(item['exercise_id'] ?? ''),
      exercise_name: String(item['exercise_name'] ?? ''),
      muscle_group: String(item['muscle_group'] ?? ''),
      set_number: Number(item['set_number'] ?? 0),
      reps: Number(item['reps'] ?? 0),
      weight_kg: Number(item['weight_kg'] ?? 0),
      volume_kg: Number(item['volume_kg'] ?? 0),
    };
  });

  return {
    id: String(row['id'] ?? ''),
    user_id: String(row['user_id'] ?? ''),
    workout_date: String(row['workout_date'] ?? ''),
    routine_id: typeof row['routine_id'] === 'string' ? row['routine_id'] : null,
    routine_name_snapshot: String(row['routine_name_snapshot'] ?? ''),
    mode: row['mode'] as DailyWorkoutLog['mode'],
    status: row['status'] as DailyWorkoutLog['status'],
    source: row['source'] as DailyWorkoutLog['source'],
    started_at: String(row['started_at'] ?? ''),
    capture_at: typeof row['capture_at'] === 'string' ? row['capture_at'] : null,
    completed_at: typeof row['completed_at'] === 'string' ? row['completed_at'] : null,
    total_volume_kg: Number(row['total_volume_kg'] ?? 0),
    sets_snapshot: setsSnapshot,
    created_at: String(row['created_at'] ?? ''),
    updated_at: String(row['updated_at'] ?? ''),
  };
}
