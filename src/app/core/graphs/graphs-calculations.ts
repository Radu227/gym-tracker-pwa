import type { ChartConfiguration } from 'chart.js';

import type { Profile } from '../profile/profile.service';
import { toDateKey } from '../progress/progress.service';
import type { DailyWorkoutLog } from '../workouts/daily-workout.service';

export type ForceMetric = 'weight' | 'oneRm';

export interface GraphSet {
  id: string;
  exerciseId: string;
  exerciseName: string;
  muscleGroup: string;
  setNumber: number;
  reps: number;
  weightKg: number;
  performedAt: string;
  isInActiveRoutine?: boolean;
}

export interface StrengthEventPoint {
  id: string;
  workoutSetId: string;
  exerciseId: string;
  exerciseName: string;
  eventType: 'recorded' | 'corrected' | 'voided';
  reps: number;
  weightKg: number;
  isVoided: boolean;
  effectiveAt: string;
  createdAt: string;
}

export interface ExerciseChoice {
  id: string;
  name: string;
  count: number;
}

export function buildWeeklyVolumeData(logs: DailyWorkoutLog[], now = new Date()): ChartConfiguration<'bar'>['data'] {
  if (logs.length === 0) {
    return emptyBarData();
  }

  const values = new Map<string, number>();
  for (let index = 7; index >= 0; index -= 1) {
    const date = new Date(now);
    date.setDate(now.getDate() - index * 7);
    date.setHours(0, 0, 0, 0);
    values.set(getMondayKey(date), 0);
  }

  for (const log of logs) {
    const date = parseLocalDate(log.workout_date);
    if (!date) {
      continue;
    }
    const key = getMondayKey(date);
    if (values.has(key)) {
      values.set(key, roundVolume((values.get(key) ?? 0) + log.total_volume_kg));
    }
  }

  return {
    labels: [...values.keys()].map(formatWeekLabel),
    datasets: [
      {
        data: [...values.values()],
        label: 'Volum săptămânal (kg)',
        backgroundColor: '#F59E0B',
        borderRadius: 6,
      },
    ],
  };
}

export function buildMonthlyVolumeData(logs: DailyWorkoutLog[], now = new Date()): ChartConfiguration<'bar'>['data'] {
  if (logs.length === 0) {
    return emptyBarData();
  }

  const values = new Map<string, number>();
  for (let index = 5; index >= 0; index -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    values.set(key, 0);
  }

  for (const log of logs) {
    const key = log.workout_date.slice(0, 7);
    if (values.has(key)) {
      values.set(key, roundVolume((values.get(key) ?? 0) + log.total_volume_kg));
    }
  }

  return {
    labels: [...values.keys()].map(formatMonthLabel),
    datasets: [
      {
        data: [...values.values()],
        label: 'Volum lunar (kg)',
        backgroundColor: '#F59E0B',
        borderRadius: 6,
      },
    ],
  };
}

export function buildMuscleDistributionData(sets: GraphSet[]): ChartConfiguration<'doughnut'>['data'] {
  const totalsByKey = new Map<string, { label: string; total: number }>();
  for (const set of sets) {
    if (set.isInActiveRoutine === false) {
      continue;
    }
    const label = set.muscleGroup.trim() || 'Nespecificat';
    const key = label.toLocaleLowerCase('ro-RO');
    const existing = totalsByKey.get(key);
    const addedVolume = set.weightKg * set.reps;
    if (existing) {
      existing.total = roundVolume(existing.total + addedVolume);
    } else {
      totalsByKey.set(key, { label, total: roundVolume(addedVolume) });
    }
  }

  if (totalsByKey.size === 0) {
    return emptyDoughnutData();
  }

  const sorted = [...totalsByKey.values()].sort((left, right) => right.total - left.total);
  const labels = sorted.map((entry) => entry.label);
  return {
    labels,
    datasets: [
      {
        data: sorted.map((entry) => entry.total),
        backgroundColor: labels.map((_, index) => muscleColor(index)),
        borderColor: '#14161C',
        borderWidth: 2,
      },
    ],
  };
}

export function buildExerciseChoicesFromEvents(events: StrengthEventPoint[]): ExerciseChoice[] {
  const counts = new Map<string, ExerciseChoice>();
  for (const event of events) {
    if (event.isVoided) {
      continue;
    }
    const current = counts.get(event.exerciseId);
    counts.set(event.exerciseId, {
      id: event.exerciseId,
      name: event.exerciseName,
      count: (current?.count ?? 0) + 1,
    });
  }
  return [...counts.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

export function buildStrengthChartData(
  events: StrengthEventPoint[],
  exerciseId: string | null,
  metric: ForceMetric,
): ChartConfiguration<'line'>['data'] {
  if (!exerciseId) {
    return emptyLineData();
  }

  const selectedEvents = events
    .filter((event) => event.exerciseId === exerciseId)
    .sort(
      (left, right) =>
        new Date(left.effectiveAt).getTime() - new Date(right.effectiveAt).getTime() ||
        new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
    );

  // Keep only the final state of each workoutSetId per day so same-day typos or voids don't leave phantom spikes.
  const dailySetStates = new Map<string, Map<string, StrengthEventPoint>>();
  for (const event of selectedEvents) {
    const dayKey = toDateKey(new Date(event.effectiveAt));
    let setStates = dailySetStates.get(dayKey);
    if (!setStates) {
      setStates = new Map<string, StrengthEventPoint>();
      dailySetStates.set(dayKey, setStates);
    }
    setStates.set(event.workoutSetId, event);
  }

  const byDay = new Map<string, number>();
  for (const dayKey of [...dailySetStates.keys()].sort()) {
    const setStates = dailySetStates.get(dayKey)!;
    let dailyBest = 0;
    let hasActiveSet = false;
    for (const state of setStates.values()) {
      if (state.isVoided) {
        continue;
      }
      hasActiveSet = true;
      const value = metric === 'weight' ? state.weightKg : state.weightKg * (1 + state.reps / 30);
      dailyBest = Math.max(dailyBest, value);
    }
    if (hasActiveSet) {
      byDay.set(dayKey, roundVolume(dailyBest));
    }
  }

  if (byDay.size === 0) {
    return emptyLineData();
  }

  return {
    labels: [...byDay.keys()].map(formatDayLabel),
    datasets: [
      {
        data: [...byDay.values()],
        label: metric === 'weight' ? 'Greutate maximă (kg)' : '1RM estimat (kg)',
        borderColor: '#F59E0B',
        backgroundColor: 'rgba(245, 158, 11, 0.18)',
        tension: 0.3,
        fill: true,
      },
    ],
  };
}

export function buildRelativeStrengthData(
  sets: GraphSet[],
  profile: Profile | null,
): ChartConfiguration<'bar'>['data'] {
  if (!profile?.weight_kg || !profile.height_cm || !profile.age || !profile.avatar_style) {
    return emptyBarData();
  }

  const topExercises = new Map<string, { name: string; oneRm: number }>();
  for (const set of sets) {
    const oneRm = set.weightKg * (1 + set.reps / 30);
    const current = topExercises.get(set.exerciseId);
    if (!current || oneRm > current.oneRm) {
      topExercises.set(set.exerciseId, { name: set.exerciseName, oneRm });
    }
  }
  const rows = [...topExercises.values()].sort((left, right) => right.oneRm - left.oneRm).slice(0, 6);
  return {
    labels: rows.map((row) => row.name),
    datasets: [
      {
        data: rows.map((row) => Number((row.oneRm / profile.weight_kg!).toFixed(2))),
        label: 'Multiplu greutate corporală',
        backgroundColor: '#F59E0B',
        borderRadius: 6,
      },
    ],
  };
}

export function emptyBarData(): ChartConfiguration<'bar'>['data'] {
  return { labels: [], datasets: [{ data: [] }] };
}

export function emptyLineData(): ChartConfiguration<'line'>['data'] {
  return { labels: [], datasets: [{ data: [] }] };
}

export function emptyDoughnutData(): ChartConfiguration<'doughnut'>['data'] {
  return { labels: [], datasets: [{ data: [] }] };
}

function getMondayKey(date: Date): string {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7));
  return toDateKey(monday);
}

function parseLocalDate(value: string): Date | null {
  const parts = value.slice(0, 10).split('-').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) {
    return null;
  }
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function roundVolume(value: number): number {
  return Math.round(value * 100) / 100;
}

function muscleColor(index: number): string {
  return `hsl(${(index * 137.5) % 360} 75% 55%)`;
}

function formatWeekLabel(key: string): string {
  return new Date(`${key}T00:00:00`).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit' });
}

function formatMonthLabel(key: string): string {
  return new Date(`${key}-01T00:00:00`).toLocaleDateString('ro-RO', { month: 'short' });
}

function formatDayLabel(key: string): string {
  return new Date(`${key}T00:00:00`).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit' });
}
