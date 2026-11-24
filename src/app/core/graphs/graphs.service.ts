import { inject, Injectable } from '@angular/core';

import { WorkoutLocalStore } from '../offline/workout-local-store';
import { SupabaseClientService } from '../supabase/supabase-client.service';
import { DailyWorkoutService, type DailyWorkoutLog } from '../workouts/daily-workout.service';

import type { GraphSet, StrengthEventPoint } from './graphs-calculations';

export type { GraphSet, StrengthEventPoint } from './graphs-calculations';

export interface GraphsData {
  completedLogs: DailyWorkoutLog[];
  currentSets: GraphSet[];
  strengthEvents: StrengthEventPoint[];
}

interface SessionMetadata {
  startedAtMs: number;
  isAbandoned: boolean;
}

interface ExerciseMeta {
  name: string;
  muscleGroup: string;
  isInActiveRoutine: boolean;
}

interface CurrentSetQueryRow {
  workout_set_id: string;
  session_id: string;
  exercise_id: string;
  set_number: number;
  reps: number;
  weight_kg: number;
  performed_at: string;
}

interface EventQueryRow {
  id: string;
  workout_set_id: string;
  event_type: 'recorded' | 'corrected' | 'voided';
  reps: number;
  weight_kg: number;
  is_voided: boolean;
  performed_at: string;
  created_at: string;
  workout_sets: { exercise_id: string; session_id: string } | { exercise_id: string; session_id: string }[] | null;
}

const PAGE_SIZE = 1000;

@Injectable({ providedIn: 'root' })
export class GraphsService {
  private readonly dailyWorkoutService = inject(DailyWorkoutService);
  private readonly localStore = inject(WorkoutLocalStore);
  private readonly supabase = inject(SupabaseClientService);

  async loadGraphsData(userId: string): Promise<GraphsData> {
    const [completedLogs, exercisesResult, routineExercisesResult, sessionsResult, pending] = await Promise.all([
      this.dailyWorkoutService.listCompletedLogs(userId),
      this.supabase.client.from('exercises').select('id,name,primary_muscle_group').eq('user_id', userId),
      this.supabase.client
        .from('routine_exercises')
        .select('exercise_id,routine_muscle_groups(name)')
        .eq('user_id', userId),
      this.supabase.client.from('workout_sessions').select('id,started_at,status').eq('user_id', userId),
      this.localStore.getPendingSets(userId),
    ]);

    if (exercisesResult.error) {
      throw exercisesResult.error;
    }
    if (routineExercisesResult.error) {
      throw routineExercisesResult.error;
    }
    if (sessionsResult.error) {
      throw sessionsResult.error;
    }

    const muscleGroupByExercise = new Map<string, string>();
    for (const row of routineExercisesResult.data ?? []) {
      const group = Array.isArray(row.routine_muscle_groups) ? row.routine_muscle_groups[0] : row.routine_muscle_groups;
      if (group?.name && !muscleGroupByExercise.has(row.exercise_id)) {
        muscleGroupByExercise.set(row.exercise_id, group.name);
      }
    }

    const exerciseById = new Map<string, ExerciseMeta>(
      (exercisesResult.data ?? []).map((exercise) => [
        exercise.id,
        {
          name: exercise.name,
          muscleGroup: muscleGroupByExercise.get(exercise.id) ?? exercise.primary_muscle_group,
          isInActiveRoutine: muscleGroupByExercise.has(exercise.id),
        },
      ]),
    );

    const sessionMetaById = new Map<string, SessionMetadata>(
      (sessionsResult.data ?? []).map((session) => [
        session.id,
        {
          startedAtMs: new Date(session.started_at).getTime(),
          isAbandoned: session.status === 'abandoned',
        },
      ]),
    );

    const [currentSets, strengthEvents] = await Promise.all([
      this.listCurrentSets(userId, exerciseById, sessionMetaById, pending),
      this.listStrengthEvents(userId, exerciseById, sessionMetaById, pending),
    ]);

    return { completedLogs, currentSets, strengthEvents };
  }

  private async listCurrentSets(
    userId: string,
    exerciseById: Map<string, ExerciseMeta>,
    sessionMetaById: Map<string, SessionMetadata>,
    pending: Awaited<ReturnType<WorkoutLocalStore['getPendingSets']>>,
  ): Promise<GraphSet[]> {
    const remoteSets: CurrentSetQueryRow[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await this.supabase.client
        .from('workout_set_current')
        .select('workout_set_id,session_id,exercise_id,set_number,reps,weight_kg,performed_at')
        .eq('user_id', userId)
        .eq('is_voided', false)
        .order('performed_at', { ascending: false })
        .order('workout_set_id', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        throw error;
      }

      const batch = (data ?? []) as CurrentSetQueryRow[];
      remoteSets.push(...batch);
      if (batch.length < PAGE_SIZE) {
        break;
      }
    }

    const remoteIds = new Set(remoteSets.map((set) => set.workout_set_id));
    const combined = [
      ...remoteSets.map((set) => ({
        id: set.workout_set_id,
        sessionId: set.session_id,
        exerciseId: set.exercise_id,
        setNumber: Number(set.set_number),
        reps: Number(set.reps),
        weightKg: Number(set.weight_kg),
        performedAt: set.performed_at,
      })),
      ...pending
        .filter((item) => !remoteIds.has(item.set.id))
        .map((item) => ({
          id: item.set.id,
          sessionId: item.set.workoutSessionId,
          exerciseId: item.set.exerciseId,
          setNumber: item.set.setNumber,
          reps: item.set.reps,
          weightKg: item.set.weightKg,
          performedAt: item.set.performedAt,
        })),
    ].filter((set) => !sessionMetaById.get(set.sessionId)?.isAbandoned);

    combined.sort((left, right) => {
      const leftSessionTime = sessionMetaById.get(left.sessionId)?.startedAtMs ?? 0;
      const rightSessionTime = sessionMetaById.get(right.sessionId)?.startedAtMs ?? 0;
      return (
        rightSessionTime - leftSessionTime ||
        new Date(right.performedAt).getTime() - new Date(left.performedAt).getTime() ||
        left.setNumber - right.setNumber
      );
    });

    const latestByExerciseAndNumber = new Map<string, GraphSet>();
    for (const set of combined) {
      const exercise = exerciseById.get(set.exerciseId);
      if (!exercise) {
        continue;
      }
      const dedupeKey = `${set.exerciseId}:${set.setNumber}`;
      if (!latestByExerciseAndNumber.has(dedupeKey)) {
        latestByExerciseAndNumber.set(dedupeKey, {
          id: set.id,
          exerciseId: set.exerciseId,
          exerciseName: exercise.name,
          muscleGroup: exercise.muscleGroup,
          setNumber: set.setNumber,
          reps: set.reps,
          weightKg: set.weightKg,
          performedAt: set.performedAt,
          isInActiveRoutine: exercise.isInActiveRoutine,
        });
      }
    }

    return [...latestByExerciseAndNumber.values()];
  }

  private async listStrengthEvents(
    userId: string,
    exerciseById: Map<string, ExerciseMeta>,
    sessionMetaById: Map<string, SessionMetadata>,
    pending: Awaited<ReturnType<WorkoutLocalStore['getPendingSets']>>,
  ): Promise<StrengthEventPoint[]> {
    const remoteRows: EventQueryRow[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await this.supabase.client
        .from('workout_set_events')
        .select(
          'id,workout_set_id,event_type,reps,weight_kg,is_voided,performed_at,created_at,workout_sets!inner(exercise_id,session_id)',
        )
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        throw error;
      }

      const batch = (data ?? []) as EventQueryRow[];
      remoteRows.push(...batch);
      if (batch.length < PAGE_SIZE) {
        break;
      }
    }

    const remoteSetIds = new Set(remoteRows.map((row) => row.workout_set_id));
    const events: StrengthEventPoint[] = [];

    for (const row of remoteRows) {
      const workoutSet = Array.isArray(row.workout_sets) ? row.workout_sets[0] : row.workout_sets;
      if (!workoutSet || sessionMetaById.get(workoutSet.session_id)?.isAbandoned) {
        continue;
      }
      const exercise = exerciseById.get(workoutSet.exercise_id);
      if (!exercise) {
        continue;
      }
      events.push({
        id: row.id,
        workoutSetId: row.workout_set_id,
        exerciseId: workoutSet.exercise_id,
        exerciseName: exercise.name,
        eventType: row.event_type,
        reps: Number(row.reps),
        weightKg: Number(row.weight_kg),
        isVoided: row.is_voided,
        effectiveAt: row.event_type === 'recorded' ? earlierIso(row.performed_at, row.created_at) : row.created_at,
        createdAt: row.created_at,
      });
    }

    for (const item of pending) {
      if (remoteSetIds.has(item.set.id) || sessionMetaById.get(item.set.workoutSessionId)?.isAbandoned) {
        continue;
      }
      const exercise = exerciseById.get(item.set.exerciseId);
      if (!exercise) {
        continue;
      }
      events.push({
        id: item.set.id,
        workoutSetId: item.set.id,
        exerciseId: item.set.exerciseId,
        exerciseName: exercise.name,
        eventType: 'recorded',
        reps: item.set.reps,
        weightKg: item.set.weightKg,
        isVoided: false,
        effectiveAt: item.set.performedAt,
        createdAt: item.set.createdAt,
      });
    }

    return events;
  }
}

function earlierIso(left: string, right: string): string {
  return new Date(left).getTime() <= new Date(right).getTime() ? left : right;
}
