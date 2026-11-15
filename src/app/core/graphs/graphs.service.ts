import { inject, Injectable } from '@angular/core';

import { WorkoutLocalStore } from '../offline/workout-local-store';
import { SupabaseClientService } from '../supabase/supabase-client.service';

export interface GraphSet {
  id: string;
  exerciseId: string;
  exerciseName: string;
  muscleGroup: string;
  reps: number;
  weightKg: number;
  performedAt: string;
}

@Injectable({ providedIn: 'root' })
export class GraphsService {
  private readonly localStore = inject(WorkoutLocalStore);
  private readonly supabase = inject(SupabaseClientService);

  async listSets(userId: string): Promise<GraphSet[]> {
    const [
      { data: remoteSets, error: setsError },
      { data: exercises, error: exercisesError },
      { data: routineExercises, error: routineExercisesError },
      pending,
    ] = await Promise.all([
      this.supabase.client
        .from('workout_set_current')
        .select('workout_set_id,exercise_id,reps,weight_kg,performed_at')
        .eq('user_id', userId)
        .eq('is_voided', false)
        .order('performed_at', { ascending: true })
        .limit(5000),
      this.supabase.client.from('exercises').select('id,name,primary_muscle_group').eq('user_id', userId),
      this.supabase.client
        .from('routine_exercises')
        .select('exercise_id,routine_muscle_groups(name)')
        .eq('user_id', userId),
      this.localStore.getPendingSets(userId),
    ]);

    if (setsError) {
      throw setsError;
    }
    if (exercisesError) {
      throw exercisesError;
    }
    if (routineExercisesError) {
      throw routineExercisesError;
    }

    const muscleGroupByExercise = new Map<string, string>();
    for (const row of routineExercises ?? []) {
      const group = Array.isArray(row.routine_muscle_groups) ? row.routine_muscle_groups[0] : row.routine_muscle_groups;
      if (group?.name && !muscleGroupByExercise.has(row.exercise_id)) {
        muscleGroupByExercise.set(row.exercise_id, group.name);
      }
    }
    const exerciseById = new Map(
      (exercises ?? []).map((exercise) => [
        exercise.id,
        {
          name: exercise.name,
          muscleGroup: muscleGroupByExercise.get(exercise.id) ?? exercise.primary_muscle_group,
        },
      ]),
    );
    const remoteIds = new Set((remoteSets ?? []).map((set) => set.workout_set_id));
    const allSets = [
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

    return allSets
      .map((set) => {
        const exercise = exerciseById.get(set.exerciseId);
        if (!exercise) {
          return null;
        }
        return { ...set, exerciseName: exercise.name, muscleGroup: exercise.muscleGroup };
      })
      .filter((set): set is GraphSet => set !== null);
  }
}
