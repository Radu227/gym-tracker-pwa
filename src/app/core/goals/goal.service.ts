import { inject, Injectable } from '@angular/core';

import { SupabaseClientService } from '../supabase/supabase-client.service';

export interface ExerciseOption {
  id: string;
  name: string;
  primary_muscle_group: string;
}

export interface ExerciseGoal {
  id: string;
  exerciseId: string;
  exerciseName: string;
  targetWeightKg: number;
  targetReps: number;
  achievedWeightKg: number;
  achievedReps: number;
  progress: number;
  isEquivalent: boolean;
  createdAt: string;
}

interface GoalRow {
  id: string;
  exercise_id: string;
  target_weight_kg: number;
  target_reps: number;
  created_at: string;
  exercises: ExerciseOption | ExerciseOption[] | null;
}

interface SetRow {
  exercise_id: string;
  weight_kg: number;
  reps: number;
}

@Injectable({ providedIn: 'root' })
export class GoalService {
  private readonly supabase = inject(SupabaseClientService);

  async listExercises(userId: string): Promise<ExerciseOption[]> {
    const { data, error } = await this.supabase.client
      .from('exercises')
      .select('id,name,primary_muscle_group')
      .eq('user_id', userId)
      .order('name', { ascending: true });

    if (error) {
      throw error;
    }

    return (data ?? []) as ExerciseOption[];
  }

  async listGoals(userId: string): Promise<ExerciseGoal[]> {
    const [{ data: goalRows, error: goalsError }, { data: sets, error: setsError }] = await Promise.all([
      this.supabase.client
        .from('exercise_goals')
        .select('id,exercise_id,target_weight_kg,target_reps,created_at,exercises(id,name,primary_muscle_group)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      this.supabase.client
        .from('workout_set_current')
        .select('exercise_id,weight_kg,reps')
        .eq('user_id', userId)
        .eq('is_voided', false)
        .limit(5000),
    ]);

    if (goalsError) {
      throw goalsError;
    }
    if (setsError) {
      throw setsError;
    }

    const bestByExercise = new Map<string, SetRow>();
    for (const set of (sets ?? []) as SetRow[]) {
      const current = bestByExercise.get(set.exercise_id);
      if (!current || estimatedOneRm(set.weight_kg, set.reps) > estimatedOneRm(current.weight_kg, current.reps)) {
        bestByExercise.set(set.exercise_id, set);
      }
    }

    return ((goalRows ?? []) as GoalRow[]).map((row) => {
      const exercise = Array.isArray(row.exercises) ? row.exercises[0] : row.exercises;
      const achieved = bestByExercise.get(row.exercise_id);
      const targetOneRm = estimatedOneRm(Number(row.target_weight_kg), Number(row.target_reps));
      const achievedOneRm = achieved ? estimatedOneRm(Number(achieved.weight_kg), Number(achieved.reps)) : 0;
      const reachedExactTarget = Boolean(
        achieved &&
        Number(achieved.weight_kg) >= Number(row.target_weight_kg) &&
        Number(achieved.reps) >= Number(row.target_reps),
      );
      const isEquivalent = Boolean(achieved && achievedOneRm >= targetOneRm && !reachedExactTarget);

      return {
        id: row.id,
        exerciseId: row.exercise_id,
        exerciseName: exercise?.name ?? 'Exercițiu necunoscut',
        targetWeightKg: Number(row.target_weight_kg),
        targetReps: Number(row.target_reps),
        achievedWeightKg: achieved ? Number(achieved.weight_kg) : 0,
        achievedReps: achieved ? Number(achieved.reps) : 0,
        progress: targetOneRm > 0 ? (reachedExactTarget ? 1 : Math.min(0.99, achievedOneRm / targetOneRm)) : 0,
        isEquivalent,
        createdAt: row.created_at,
      };
    });
  }

  async createGoal(userId: string, exerciseId: string, targetWeightKg: number, targetReps: number): Promise<void> {
    if (!exerciseId || !Number.isFinite(targetWeightKg) || targetWeightKg <= 0) {
      throw new Error('Introdu o greutate țintă mai mare decât 0.');
    }
    if (!Number.isInteger(targetReps) || targetReps < 1 || targetReps > 1000) {
      throw new Error('Repetările țintă trebuie să fie între 1 și 1000.');
    }

    const { error } = await this.supabase.client.from('exercise_goals').insert({
      user_id: userId,
      exercise_id: exerciseId,
      target_weight_kg: targetWeightKg,
      target_reps: targetReps,
    });

    if (error) {
      throw error;
    }
  }

  async deleteGoal(userId: string, goalId: string): Promise<void> {
    const { error } = await this.supabase.client.from('exercise_goals').delete().eq('user_id', userId).eq('id', goalId);
    if (error) {
      throw error;
    }
  }
}

export function estimatedOneRm(weightKg: number, reps: number): number {
  return weightKg * (1 + reps / 30);
}
