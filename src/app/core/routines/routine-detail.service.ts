import { inject, Injectable } from '@angular/core';

import { SupabaseClientService } from '../supabase/supabase-client.service';

export interface MuscleGroup {
  id: string;
  routine_id: string;
  user_id: string;
  name: string;
  sort_order: number;
}

export interface RoutineExercise {
  id: string;
  muscle_group_id: string;
  exercise_id: string;
  sort_order: number;
  exercise: {
    id: string;
    name: string;
    primary_muscle_group: string;
  };
}

export interface SameNamedMuscleGroup {
  id: string;
  routine_id: string;
  name: string;
}

export interface ExistingExerciseGroup {
  exerciseName: string;
  muscleGroups: string[];
}

@Injectable({ providedIn: 'root' })
export class RoutineDetailService {
  private readonly supabase = inject(SupabaseClientService);
  private readonly muscleGroupCache = new Map<string, { expiresAt: number; groups: MuscleGroup[] }>();
  private readonly exerciseCache = new Map<string, { expiresAt: number; exercises: RoutineExercise[] }>();

  async listMuscleGroups(userId: string, routineId: string): Promise<MuscleGroup[]> {
    const cacheKey = `${userId}:${routineId}`;
    const cached = this.muscleGroupCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.groups;
    }

    const { data, error } = await this.supabase.client
      .from('routine_muscle_groups')
      .select('id,routine_id,user_id,name,sort_order')
      .eq('user_id', userId)
      .eq('routine_id', routineId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    const groups = (data ?? []) as MuscleGroup[];
    this.muscleGroupCache.set(cacheKey, { expiresAt: Date.now() + 30_000, groups });
    return groups;
  }

  async listExercises(userId: string, muscleGroupId: string): Promise<RoutineExercise[]> {
    const cacheKey = `${userId}:${muscleGroupId}`;
    const cached = this.exerciseCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.exercises;
    }

    const { data, error } = await this.supabase.client
      .from('routine_exercises')
      .select('id,muscle_group_id,exercise_id,sort_order,exercises(id,name,primary_muscle_group)')
      .eq('user_id', userId)
      .eq('muscle_group_id', muscleGroupId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    const exercises = (data ?? []).map((row) => {
      const exercise = Array.isArray(row.exercises) ? row.exercises[0] : row.exercises;
      if (!exercise) {
        throw new Error('Un exercițiu din acest antrenament nu mai există.');
      }

      return {
        id: row.id,
        muscle_group_id: row.muscle_group_id,
        exercise_id: row.exercise_id,
        sort_order: row.sort_order,
        exercise,
      } as RoutineExercise;
    });
    this.exerciseCache.set(cacheKey, { expiresAt: Date.now() + 30_000, exercises });
    return exercises;
  }

  async createMuscleGroup(
    userId: string,
    routineId: string,
    name: string,
    reuseFromGroupId?: string,
  ): Promise<MuscleGroup> {
    const normalizedName = name.trim();
    if (!normalizedName || normalizedName.length > 80) {
      throw new Error('Numele grupei trebuie să aibă între 1 și 80 de caractere.');
    }

    const { data, error } = await this.supabase.client
      .from('routine_muscle_groups')
      .insert({ user_id: userId, routine_id: routineId, name: normalizedName })
      .select('id,routine_id,user_id,name,sort_order')
      .single();

    if (error) {
      throw error;
    }

    const group = data as MuscleGroup;
    const cacheKey = `${userId}:${routineId}`;
    const cached = this.muscleGroupCache.get(cacheKey);
    if (cached) {
      this.muscleGroupCache.set(cacheKey, { expiresAt: Date.now() + 30_000, groups: [...cached.groups, group] });
    }

    if (reuseFromGroupId) {
      const { data: sourceExercises, error: sourceError } = await this.supabase.client
        .from('routine_exercises')
        .select('exercise_id,sort_order,target_sets,target_reps_min,target_reps_max')
        .eq('user_id', userId)
        .eq('muscle_group_id', reuseFromGroupId);

      if (sourceError) {
        throw sourceError;
      }

      if (sourceExercises && sourceExercises.length > 0) {
        const { error: cloneError } = await this.supabase.client.from('routine_exercises').insert(
          sourceExercises.map((exercise) => ({
            user_id: userId,
            muscle_group_id: group.id,
            exercise_id: exercise.exercise_id,
            sort_order: exercise.sort_order,
            target_sets: exercise.target_sets,
            target_reps_min: exercise.target_reps_min,
            target_reps_max: exercise.target_reps_max,
          })),
        );
        if (cloneError) {
          throw cloneError;
        }
      }
    }

    return group;
  }

  async findSameNamedGroup(userId: string, routineId: string, name: string): Promise<SameNamedMuscleGroup | null> {
    const { data, error } = await this.supabase.client
      .from('routine_muscle_groups')
      .select('id,routine_id,name')
      .eq('user_id', userId)
      .neq('routine_id', routineId)
      .ilike('name', name.trim())
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data as SameNamedMuscleGroup | null;
  }

  async createExercise(userId: string, muscleGroupId: string, name: string): Promise<RoutineExercise> {
    const normalizedName = name.trim();
    if (!normalizedName || normalizedName.length > 120) {
      throw new Error('Numele exercițiului trebuie să aibă între 1 și 120 de caractere.');
    }

    const { data: exercise, error: exerciseError } = await this.supabase.client
      .from('exercises')
      .insert({
        user_id: userId,
        name: normalizedName,
        primary_muscle_group: 'Nespecificat',
      })
      .select('id,name,primary_muscle_group')
      .single();

    if (exerciseError) {
      throw exerciseError;
    }

    const { data: routineExercise, error: routineExerciseError } = await this.supabase.client
      .from('routine_exercises')
      .insert({
        user_id: userId,
        muscle_group_id: muscleGroupId,
        exercise_id: exercise.id,
      })
      .select('id,muscle_group_id,exercise_id,sort_order')
      .single();

    if (routineExerciseError) {
      throw routineExerciseError;
    }

    const result = {
      ...routineExercise,
      exercise,
    } as RoutineExercise;
    const cacheKey = `${userId}:${muscleGroupId}`;
    const cached = this.exerciseCache.get(cacheKey);
    if (cached) {
      this.exerciseCache.set(cacheKey, { expiresAt: Date.now() + 30_000, exercises: [...cached.exercises, result] });
    }
    return result;
  }

  async findExistingExerciseGroups(userId: string, name: string): Promise<ExistingExerciseGroup | null> {
    const normalizedName = name.trim();
    const { data: exercise, error: exerciseError } = await this.supabase.client
      .from('exercises')
      .select('id,name')
      .eq('user_id', userId)
      .ilike('name', normalizedName)
      .maybeSingle();

    if (exerciseError) {
      throw exerciseError;
    }
    if (!exercise) {
      return null;
    }

    const { data: links, error: linksError } = await this.supabase.client
      .from('routine_exercises')
      .select('routine_muscle_groups(name)')
      .eq('user_id', userId)
      .eq('exercise_id', exercise.id);

    if (linksError) {
      throw linksError;
    }

    const muscleGroups = (links ?? [])
      .map((link) => {
        const group = Array.isArray(link.routine_muscle_groups)
          ? link.routine_muscle_groups[0]
          : link.routine_muscle_groups;
        return group?.name;
      })
      .filter((group): group is string => Boolean(group));

    return { exerciseName: exercise.name, muscleGroups: [...new Set(muscleGroups)] };
  }
}
