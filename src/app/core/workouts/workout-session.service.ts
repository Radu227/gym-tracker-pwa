import { inject, Injectable } from '@angular/core';

import { SupabaseClientService } from '../supabase/supabase-client.service';

export interface WorkoutSession {
  id: string;
  user_id: string;
  routine_id: string | null;
  routine_name_snapshot: string | null;
  status: 'in_progress' | 'completed' | 'abandoned';
  started_at: string;
  completed_at: string | null;
  notes: string | null;
}

export interface CurrentWorkoutSet {
  workout_set_id: string;
  current_event_id: string;
  session_id: string;
  exercise_id: string;
  set_number: number;
  reps: number;
  weight_kg: number;
  is_failure: boolean;
  is_voided: boolean;
  notes: string | null;
  performed_at: string;
}

export interface ExerciseSummary {
  id: string;
  name: string;
  primary_muscle_group: string;
}

export interface WorkoutSetHistoryEntry {
  id: string;
  event_type: 'recorded' | 'corrected' | 'voided';
  reps: number;
  weight_kg: number;
  is_failure: boolean;
  is_voided: boolean;
  notes: string | null;
  performed_at: string;
  created_at: string;
  set_number: number;
}

export interface ExerciseOption {
  id: string;
  name: string;
  primary_muscle_group: string | null;
}

@Injectable({ providedIn: 'root' })
export class WorkoutSessionService {
  private readonly supabase = inject(SupabaseClientService);

  async getExercise(userId: string, exerciseId: string): Promise<ExerciseSummary> {
    const { data, error } = await this.supabase.client
      .from('exercises')
      .select('id,name,primary_muscle_group')
      .eq('user_id', userId)
      .eq('id', exerciseId)
      .single();

    if (error) {
      throw error;
    }

    return data as ExerciseSummary;
  }

  async createSession(userId: string, routineId: string, routineName: string): Promise<WorkoutSession> {
    const { data, error } = await this.supabase.client
      .from('workout_sessions')
      .insert({
        user_id: userId,
        routine_id: routineId,
        routine_name_snapshot: routineName,
      })
      .select('id,user_id,routine_id,routine_name_snapshot,status,started_at,completed_at,notes')
      .single();

    if (error) {
      throw error;
    }

    return data as WorkoutSession;
  }

  async completeSession(userId: string, sessionId: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('workout_sessions')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', sessionId)
      .eq('user_id', userId)
      .eq('status', 'in_progress');

    if (error) {
      throw error;
    }
  }

  async listLastSets(userId: string, exerciseId: string): Promise<CurrentWorkoutSet[]> {
    const { data, error } = await this.supabase.client
      .from('workout_set_current')
      .select(
        'workout_set_id,current_event_id,session_id,exercise_id,set_number,reps,weight_kg,is_failure,is_voided,notes,performed_at',
      )
      .eq('user_id', userId)
      .eq('exercise_id', exerciseId)
      .eq('is_voided', false)
      .order('performed_at', { ascending: false })
      .order('set_number', { ascending: true })
      .limit(100);

    if (error) {
      throw error;
    }

    const sets = (data ?? []) as CurrentWorkoutSet[];
    const latestSessionId = sets[0]?.session_id;
    return latestSessionId
      ? sets.filter((set) => set.session_id === latestSessionId).sort((a, b) => a.set_number - b.set_number)
      : [];
  }

  async correctSet(
    set: CurrentWorkoutSet,
    values: Pick<CurrentWorkoutSet, 'reps' | 'weight_kg' | 'is_failure' | 'notes'>,
  ): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('correct_workout_set', {
      p_workout_set_id: set.workout_set_id,
      p_previous_event_id: set.current_event_id,
      p_event_type: 'corrected',
      p_reps: values.reps,
      p_weight_kg: values.weight_kg,
      p_is_failure: values.is_failure,
      p_notes: values.notes,
      p_client_mutation_id: crypto.randomUUID(),
    });

    if (error) {
      throw error;
    }

    const row = Array.isArray(data) ? data[0] : null;
    if (!row || typeof row.event_id !== 'string') {
      throw new Error('Supabase nu a returnat identificatorul modificării.');
    }
    return row.event_id;
  }

  async voidSet(set: CurrentWorkoutSet): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('correct_workout_set', {
      p_workout_set_id: set.workout_set_id,
      p_previous_event_id: set.current_event_id,
      p_event_type: 'voided',
      p_reps: set.reps,
      p_weight_kg: set.weight_kg,
      p_is_failure: set.is_failure,
      p_notes: set.notes,
      p_client_mutation_id: crypto.randomUUID(),
    });

    if (error) {
      throw error;
    }

    const row = Array.isArray(data) ? data[0] : null;
    if (!row || typeof row.event_id !== 'string') {
      throw new Error('Supabase nu a returnat identificatorul ștergerii.');
    }
    return row.event_id;
  }

  async listExercises(userId: string): Promise<ExerciseOption[]> {
    const [{ data: exercises, error: exercisesError }, { data: routineExercises, error: routineExercisesError }] =
      await Promise.all([
        this.supabase.client
          .from('exercises')
          .select('id,name,primary_muscle_group')
          .eq('user_id', userId)
          .order('name', { ascending: true }),
        this.supabase.client
          .from('routine_exercises')
          .select('exercise_id,routine_muscle_groups(name)')
          .eq('user_id', userId),
      ]);

    if (exercisesError) {
      throw exercisesError;
    }
    if (routineExercisesError) {
      throw routineExercisesError;
    }

    const muscleGroupByExercise = new Map<string, string>();
    for (const row of routineExercises ?? []) {
      const group = Array.isArray(row.routine_muscle_groups) ? row.routine_muscle_groups[0] : row.routine_muscle_groups;
      const name = normalizeMuscleGroup(group?.name);
      if (name && !muscleGroupByExercise.has(row.exercise_id)) {
        muscleGroupByExercise.set(row.exercise_id, name);
      }
    }

    return (exercises ?? [])
      .map((exercise) => ({
        id: exercise.id,
        name: exercise.name,
        primary_muscle_group:
          muscleGroupByExercise.get(exercise.id) ?? normalizeMuscleGroup(exercise.primary_muscle_group),
      }))
      .sort((left, right) => {
        const leftGroup = left.primary_muscle_group ?? '';
        const rightGroup = right.primary_muscle_group ?? '';
        return leftGroup.localeCompare(rightGroup, 'ro') || left.name.localeCompare(right.name, 'ro');
      });
  }

  async listHistory(userId: string, exerciseId: string): Promise<WorkoutSetHistoryEntry[]> {
    const { data, error } = await this.supabase.client
      .from('workout_set_events')
      .select(
        'id,event_type,reps,weight_kg,is_failure,is_voided,notes,performed_at,created_at,workout_sets!inner(exercise_id,set_number)',
      )
      .eq('user_id', userId)
      .eq('workout_sets.exercise_id', exerciseId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return (data ?? []).map((row) => {
      const workoutSet = Array.isArray(row.workout_sets) ? row.workout_sets[0] : row.workout_sets;
      if (!workoutSet) {
        throw new Error('Istoricul conține o serie fără identificare.');
      }
      return {
        id: row.id,
        event_type: row.event_type,
        reps: row.reps,
        weight_kg: row.weight_kg,
        is_failure: row.is_failure,
        is_voided: row.is_voided,
        notes: row.notes,
        performed_at: row.performed_at,
        created_at: row.created_at,
        set_number: workoutSet.set_number,
      } as WorkoutSetHistoryEntry;
    });
  }
}

function normalizeMuscleGroup(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized && normalized.toLowerCase() !== 'nespecificat' ? normalized : null;
}
