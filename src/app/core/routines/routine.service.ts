import { inject, Injectable } from '@angular/core';

import { SupabaseClientService } from '../supabase/supabase-client.service';

export interface Routine {
  id: string;
  user_id: string;
  name: string;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

@Injectable({ providedIn: 'root' })
export class RoutineService {
  private readonly supabase = inject(SupabaseClientService);
  private readonly cache = new Map<string, { expiresAt: number; routines: Routine[] }>();

  async listForUser(userId: string): Promise<Routine[]> {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.routines;
    }

    const { data, error } = await this.supabase.client
      .from('routines')
      .select('id,user_id,name,notes,sort_order,created_at,updated_at')
      .eq('user_id', userId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    const routines = (data ?? []) as Routine[];
    this.cache.set(userId, { expiresAt: Date.now() + 30_000, routines });
    return routines;
  }

  async create(userId: string, name: string, notes: string | null = null): Promise<Routine> {
    const normalizedName = name.trim();
    if (!normalizedName || normalizedName.length > 100) {
      throw new Error('Numele rutinei trebuie să aibă între 1 și 100 de caractere.');
    }

    const { data, error } = await this.supabase.client
      .from('routines')
      .insert({
        user_id: userId,
        name: normalizedName,
        notes: notes?.trim() || null,
      })
      .select('id,user_id,name,notes,sort_order,created_at,updated_at')
      .single();

    if (error) {
      throw error;
    }

    const routine = data as Routine;
    const cached = this.cache.get(userId);
    if (cached) {
      this.cache.set(userId, { expiresAt: Date.now() + 30_000, routines: [...cached.routines, routine] });
    }
    return routine;
  }

  async update(userId: string, routineId: string, name: string, notes: string | null): Promise<Routine> {
    const normalizedName = name.trim();
    if (!normalizedName || normalizedName.length > 100) {
      throw new Error('Numele rutinei trebuie să aibă între 1 și 100 de caractere.');
    }

    const { data, error } = await this.supabase.client
      .from('routines')
      .update({ name: normalizedName, notes: notes?.trim() || null, updated_at: new Date().toISOString() })
      .eq('id', routineId)
      .eq('user_id', userId)
      .select('id,user_id,name,notes,sort_order,created_at,updated_at')
      .single();

    if (error) {
      throw error;
    }

    const routine = data as Routine;
    this.invalidateUserCache(userId, routine);
    return routine;
  }

  async delete(userId: string, routineId: string): Promise<void> {
    const { error } = await this.supabase.client.from('routines').delete().eq('id', routineId).eq('user_id', userId);
    if (error) {
      throw error;
    }
    this.cache.delete(userId);
  }

  private invalidateUserCache(userId: string, updatedRoutine: Routine): void {
    const cached = this.cache.get(userId);
    if (!cached) {
      return;
    }
    this.cache.set(userId, {
      expiresAt: Date.now() + 30_000,
      routines: cached.routines
        .map((routine) => (routine.id === updatedRoutine.id ? updatedRoutine : routine))
        .sort((left, right) => left.sort_order - right.sort_order || left.created_at.localeCompare(right.created_at)),
    });
  }
}
