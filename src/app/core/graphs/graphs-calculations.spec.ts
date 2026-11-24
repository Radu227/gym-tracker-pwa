import { describe, expect, it } from 'vitest';

import type { DailyWorkoutLog } from '../workouts/daily-workout.service';

import {
  buildMonthlyVolumeData,
  buildMuscleDistributionData,
  buildStrengthChartData,
  buildWeeklyVolumeData,
  type GraphSet,
  type StrengthEventPoint,
} from './graphs-calculations';

function makeLog(overrides: Partial<DailyWorkoutLog>): DailyWorkoutLog {
  return {
    id: 'log-1',
    user_id: 'user-1',
    workout_date: '2026-11-24',
    routine_id: 'routine-1',
    routine_name_snapshot: 'Push',
    mode: 'already_done',
    status: 'completed',
    source: 'checkin',
    started_at: '2026-11-24T10:00:00.000Z',
    capture_at: '2026-11-24T10:00:00.000Z',
    completed_at: '2026-11-24T10:00:00.000Z',
    total_volume_kg: 1000,
    sets_snapshot: [],
    created_at: '2026-11-24T10:00:00.000Z',
    updated_at: '2026-11-24T10:00:00.000Z',
    ...overrides,
  };
}

function makeEvent(overrides: Partial<StrengthEventPoint>): StrengthEventPoint {
  return {
    id: 'ev-1',
    workoutSetId: 'set-1',
    exerciseId: 'ex-1',
    exerciseName: 'Împins la piept',
    eventType: 'recorded',
    reps: 8,
    weightKg: 80,
    isVoided: false,
    effectiveAt: '2026-11-18T12:00:00.000Z',
    createdAt: '2026-11-18T12:00:00.000Z',
    ...overrides,
  };
}

describe('graphs-calculations', () => {
  describe('buildWeeklyVolumeData', () => {
    it('returns empty chart data when there are no logs', () => {
      const result = buildWeeklyVolumeData([], new Date(2026, 10, 24, 15, 0));
      expect(result.labels).toEqual([]);
      expect(result.datasets[0]?.data).toEqual([]);
    });

    it('keeps legacy last-week backfill separate and sums multiple check-ins in current week', () => {
      const now = new Date(2026, 10, 24, 15, 0); // Tuesday Nov 24, 2026 (week starts Mon Nov 23)
      const logs: DailyWorkoutLog[] = [
        makeLog({
          id: 'legacy-1',
          workout_date: '2026-11-22', // Sunday of previous week (Mon Nov 16 - Sun Nov 22)
          mode: 'legacy_backfill',
          source: 'legacy_backfill',
          total_volume_kg: 4500,
        }),
        makeLog({
          id: 'cur-1',
          workout_date: '2026-11-23', // Monday Nov 23
          total_volume_kg: 1800,
        }),
        makeLog({
          id: 'cur-2',
          workout_date: '2026-11-24', // Tuesday Nov 24
          total_volume_kg: 2200,
        }),
        makeLog({
          id: 'too-old',
          workout_date: '2026-08-01', // outside 8-week window
          total_volume_kg: 9999,
        }),
      ];

      const result = buildWeeklyVolumeData(logs, now);
      const data = result.datasets[0]?.data as number[];

      expect(data).toHaveLength(8);
      expect(data.slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0]);
      expect(data[6]).toBe(4500);
      expect(data[7]).toBe(4000);
    });
  });

  describe('buildMonthlyVolumeData', () => {
    it('sums confirmed workout logs across the last 6 months', () => {
      const now = new Date(2026, 10, 24, 15, 0); // Nov 2026 (months: Jun..Nov)
      const logs: DailyWorkoutLog[] = [
        makeLog({ id: 'oct-1', workout_date: '2026-10-12', total_volume_kg: 3100 }),
        makeLog({ id: 'nov-1', workout_date: '2026-11-22', total_volume_kg: 4500 }),
        makeLog({ id: 'nov-2', workout_date: '2026-11-24', total_volume_kg: 1500 }),
      ];

      const result = buildMonthlyVolumeData(logs, now);
      const data = result.datasets[0]?.data as number[];

      expect(data).toHaveLength(6);
      expect(data[4]).toBe(3100);
      expect(data[5]).toBe(6000);
    });
  });

  describe('buildMuscleDistributionData', () => {
    function makeGraphSet(overrides: Partial<GraphSet>): GraphSet {
      return {
        id: 'set-1',
        exerciseId: 'ex-1',
        exerciseName: 'Flexii biceps',
        muscleGroup: 'Biceps',
        setNumber: 1,
        reps: 10,
        weightKg: 20,
        performedAt: '2026-11-24T12:00:00.000Z',
        isInActiveRoutine: true,
        ...overrides,
      };
    }

    it('sums active sets per muscle group case-insensitively and excludes deleted routine exercises', () => {
      const sets: GraphSet[] = [
        makeGraphSet({ id: 's-1', exerciseId: 'ex-1', muscleGroup: 'Biceps', weightKg: 20, reps: 10 }), // 200
        makeGraphSet({ id: 's-2', exerciseId: 'ex-2', muscleGroup: 'biceps', weightKg: 15, reps: 12 }), // 180
        makeGraphSet({ id: 's-3', exerciseId: 'ex-3', muscleGroup: 'Piept', weightKg: 80, reps: 8 }), // 640
        makeGraphSet({ id: 's-4', exerciseId: 'ex-4', muscleGroup: ' ', weightKg: 10, reps: 10 }), // 100 -> Nespecificat
        makeGraphSet({
          id: 's-5',
          exerciseId: 'ex-deleted',
          muscleGroup: 'Biceps',
          weightKg: 100,
          reps: 10,
          isInActiveRoutine: false,
        }),
      ];

      const result = buildMuscleDistributionData(sets);
      expect(result.labels).toEqual(['Piept', 'Biceps', 'Nespecificat']);
      expect(result.datasets[0]?.data).toEqual([640, 380, 100]);
    });

    it('returns empty doughnut data when there are no active sets', () => {
      const result = buildMuscleDistributionData([makeGraphSet({ isInActiveRoutine: false })]);
      expect(result.labels).toEqual([]);
      expect(result.datasets[0]?.data).toEqual([]);
    });
  });

  describe('buildStrengthChartData', () => {
    it('preserves last week weight when a set is corrected in the current week', () => {
      const events: StrengthEventPoint[] = [
        makeEvent({
          id: 'ev-1',
          workoutSetId: 'set-1',
          eventType: 'recorded',
          weightKg: 80,
          reps: 8,
          effectiveAt: '2026-11-18T12:00:00.000Z',
          createdAt: '2026-11-18T12:00:00.000Z',
        }),
        makeEvent({
          id: 'ev-2',
          workoutSetId: 'set-1',
          eventType: 'corrected',
          weightKg: 85,
          reps: 8,
          effectiveAt: '2026-11-24T12:00:00.000Z',
          createdAt: '2026-11-24T12:00:00.000Z',
        }),
      ];

      const result = buildStrengthChartData(events, 'ex-1', 'weight');
      expect(result.labels).toHaveLength(2);
      expect(result.datasets[0]?.data).toEqual([80, 85]);
    });

    it('ignores same-day typo spikes and same-day voided sets, and computes Epley 1RM', () => {
      const events: StrengthEventPoint[] = [
        makeEvent({
          id: 'ev-1',
          workoutSetId: 'set-1',
          eventType: 'recorded',
          weightKg: 800,
          reps: 10,
          effectiveAt: '2026-11-24T10:00:00.000Z',
          createdAt: '2026-11-24T10:00:00.000Z',
        }),
        makeEvent({
          id: 'ev-2',
          workoutSetId: 'set-1',
          eventType: 'corrected',
          weightKg: 90,
          reps: 10,
          effectiveAt: '2026-11-24T10:01:00.000Z',
          createdAt: '2026-11-24T10:01:00.000Z',
        }),
        makeEvent({
          id: 'ev-3',
          workoutSetId: 'set-2',
          eventType: 'recorded',
          weightKg: 120,
          reps: 5,
          effectiveAt: '2026-11-24T10:05:00.000Z',
          createdAt: '2026-11-24T10:05:00.000Z',
        }),
        makeEvent({
          id: 'ev-4',
          workoutSetId: 'set-2',
          eventType: 'voided',
          weightKg: 120,
          reps: 5,
          isVoided: true,
          effectiveAt: '2026-11-24T10:06:00.000Z',
          createdAt: '2026-11-24T10:06:00.000Z',
        }),
      ];

      const weightChart = buildStrengthChartData(events, 'ex-1', 'weight');
      expect(weightChart.datasets[0]?.data).toEqual([90]);

      const oneRmChart = buildStrengthChartData(events, 'ex-1', 'oneRm');
      expect(oneRmChart.datasets[0]?.data).toEqual([120]); // 90 * (1 + 10/30) = 120
    });
  });
});
