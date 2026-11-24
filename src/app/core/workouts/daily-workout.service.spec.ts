import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SupabaseClientService } from '../supabase/supabase-client.service';
import { WorkoutSyncService } from '../sync/workout-sync.service';

import { DailyWorkoutService, formatCountdown } from './daily-workout.service';

function makeRpcRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'log-1',
    user_id: 'user-1',
    workout_date: '2026-11-24',
    routine_id: 'routine-1',
    routine_name_snapshot: 'Push',
    mode: 'already_done',
    status: 'completed',
    source: 'checkin',
    started_at: '2026-11-24T12:00:00.000Z',
    capture_at: '2026-11-24T12:00:00.000Z',
    completed_at: '2026-11-24T12:00:00.000Z',
    total_volume_kg: '2450.50',
    sets_snapshot: [
      {
        exercise_id: 'ex-1',
        exercise_name: 'Bench',
        muscle_group: 'Piept',
        set_number: 1,
        reps: 10,
        weight_kg: 80,
        volume_kg: 800,
      },
    ],
    created_at: '2026-11-24T12:00:00.000Z',
    updated_at: '2026-11-24T12:00:00.000Z',
    ...overrides,
  };
}

describe('DailyWorkoutService', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('formats countdown remaining milliseconds accurately', () => {
    expect(formatCountdown(3 * 3600 * 1000)).toBe('03:00:00');
    expect(formatCountdown(65_000)).toBe('00:01:05');
    expect(formatCountdown(0)).toBe('00:00:00');
    expect(formatCountdown(-15_000)).toBe('00:00:00');
  });

  it('flushes pending sync and calls log_daily_workout_now RPC', async () => {
    const syncNow = vi.fn().mockResolvedValue(undefined);
    const rpc = vi.fn().mockResolvedValue({ data: [makeRpcRow()], error: null });

    TestBed.configureTestingModule({
      providers: [
        DailyWorkoutService,
        { provide: WorkoutSyncService, useValue: { syncNow } },
        { provide: SupabaseClientService, useValue: { client: { rpc } } },
      ],
    });

    const service = TestBed.inject(DailyWorkoutService);
    const result = await service.logCompletedNow('routine-1', '2026-11-24');

    expect(syncNow).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('log_daily_workout_now', {
      p_routine_id: 'routine-1',
      p_workout_date: '2026-11-24',
    });
    expect(result.total_volume_kg).toBe(2450.5);
    expect(result.sets_snapshot).toHaveLength(1);
  });

  it('flushes pending sync and calls log_past_daily_workout RPC', async () => {
    const syncNow = vi.fn().mockResolvedValue(undefined);
    const rpc = vi.fn().mockResolvedValue({
      data: [makeRpcRow({ mode: 'retroactive', workout_date: '2026-11-23' })],
      error: null,
    });

    TestBed.configureTestingModule({
      providers: [
        DailyWorkoutService,
        { provide: WorkoutSyncService, useValue: { syncNow } },
        { provide: SupabaseClientService, useValue: { client: { rpc } } },
      ],
    });

    const service = TestBed.inject(DailyWorkoutService);
    const result = await service.logPastWorkout('routine-1', '2026-11-23');

    expect(syncNow).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('log_past_daily_workout', {
      p_routine_id: 'routine-1',
      p_workout_date: '2026-11-23',
    });
    expect(result.mode).toBe('retroactive');
    expect(result.workout_date).toBe('2026-11-23');
  });

  it('starts, finalizes, and cancels a timed workout via RPCs', async () => {
    const syncNow = vi.fn().mockResolvedValue(undefined);
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [makeRpcRow({ mode: 'started_now', status: 'in_progress', completed_at: null, total_volume_kg: 0 })],
        error: null,
      })
      .mockResolvedValueOnce({ data: [makeRpcRow({ mode: 'started_now', status: 'completed' })], error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    TestBed.configureTestingModule({
      providers: [
        DailyWorkoutService,
        { provide: WorkoutSyncService, useValue: { syncNow } },
        { provide: SupabaseClientService, useValue: { client: { rpc } } },
      ],
    });

    const service = TestBed.inject(DailyWorkoutService);

    const started = await service.startWorkout('routine-1', '2026-11-24');
    expect(started.status).toBe('in_progress');
    expect(rpc).toHaveBeenNthCalledWith(1, 'start_daily_workout', {
      p_routine_id: 'routine-1',
      p_workout_date: '2026-11-24',
    });

    const finalized = await service.finalizeWorkout('log-1');
    expect(finalized.status).toBe('completed');
    expect(syncNow).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenNthCalledWith(2, 'finalize_daily_workout', { p_log_id: 'log-1' });

    await service.cancelWorkout('log-1');
    expect(rpc).toHaveBeenNthCalledWith(3, 'cancel_daily_workout', { p_log_id: 'log-1' });
  });

  it('finalizes due workouts before querying active and completed logs for today', async () => {
    const syncNow = vi.fn().mockResolvedValue(undefined);
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const maybeSingleActive = vi
      .fn()
      .mockResolvedValue({ data: makeRpcRow({ status: 'in_progress', mode: 'started_now' }), error: null });
    const maybeSingleCompleted = vi.fn().mockResolvedValue({ data: null, error: null });

    const from = vi.fn().mockImplementation(() => ({
      select: () => ({
        eq: (_col1: string, _val1: string) => ({
          eq: (_col2: string, val2: string) => {
            if (val2 === 'in_progress') {
              return {
                order: () => ({
                  limit: () => ({ maybeSingle: maybeSingleActive }),
                }),
              };
            }
            return {
              eq: () => ({
                eq: () => ({
                  limit: () => ({ maybeSingle: maybeSingleCompleted }),
                }),
              }),
            };
          },
        }),
      }),
    }));

    TestBed.configureTestingModule({
      providers: [
        DailyWorkoutService,
        { provide: WorkoutSyncService, useValue: { syncNow } },
        { provide: SupabaseClientService, useValue: { client: { rpc, from } } },
      ],
    });

    const service = TestBed.inject(DailyWorkoutService);
    const state = await service.getTodayState('user-1', '2026-11-24');

    expect(rpc).toHaveBeenCalledWith('finalize_due_daily_workouts');
    expect(state.activeLog?.status).toBe('in_progress');
    expect(state.completedToday).toBeNull();
  });
});
