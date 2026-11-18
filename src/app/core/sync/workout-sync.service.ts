import { inject, Injectable, signal } from '@angular/core';

import { AuthService } from '../auth/auth.service';
import { WorkoutLocalStore } from '../offline/workout-local-store';
import type { LocalWorkoutSet, RecordWorkoutSetInput } from '../offline/workout-local-store';
import { RuntimeConfigService } from '../supabase/runtime-config.service';
import { SupabaseClientService } from '../supabase/supabase-client.service';

export type WorkoutSyncState = 'idle' | 'syncing' | 'offline' | 'signed-out' | 'not-configured' | 'error';

interface RecordedSetAcknowledgement {
  workoutSetId: string;
  eventId: string;
}

@Injectable({ providedIn: 'root' })
export class WorkoutSyncService {
  readonly state = signal<WorkoutSyncState>('idle');
  readonly pendingCount = signal(0);
  readonly lastError = signal<string | null>(null);

  private readonly auth = inject(AuthService);
  private readonly config = inject(RuntimeConfigService);
  private readonly localStore = inject(WorkoutLocalStore);
  private readonly supabase = inject(SupabaseClientService);
  private initialized = false;
  private syncInFlight: Promise<void> | null = null;
  private stopListeningForUserChanges: (() => void) | null = null;

  initialize(): void {
    if (this.initialized || typeof window === 'undefined') {
      return;
    }

    this.initialized = true;
    window.addEventListener('online', this.handleOnline);
    this.stopListeningForUserChanges = this.auth.onUserChanged((user) => {
      if (user) {
        this.triggerSync();
      } else {
        this.state.set(this.config.isSupabaseConfigured ? 'signed-out' : 'not-configured');
        this.pendingCount.set(0);
      }
    });
  }

  async syncNow(): Promise<void> {
    if (this.syncInFlight) {
      return this.syncInFlight;
    }

    const operation = this.synchronize();
    this.syncInFlight = operation;

    try {
      await operation;
    } finally {
      if (this.syncInFlight === operation) {
        this.syncInFlight = null;
      }
    }
  }

  async recordSet(input: RecordWorkoutSetInput): Promise<LocalWorkoutSet> {
    const user = this.auth.currentUser();
    if (!user) {
      throw new Error('Sign in before recording a workout set');
    }

    const localSet = await this.localStore.recordSet(user.id, input);
    this.triggerSync();
    return localSet;
  }

  async deletePendingSet(setId: string): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) {
      throw new Error('Sign in before deleting a workout set');
    }
    await this.localStore.deletePendingSet(user.id, setId);
  }

  async getLocalSet(setId: string): Promise<LocalWorkoutSet | undefined> {
    const user = this.auth.currentUser();
    return user ? this.localStore.getSet(user.id, setId) : undefined;
  }

  async listLocalSets(): Promise<LocalWorkoutSet[]> {
    const user = this.auth.currentUser();
    return user ? this.localStore.listSets(user.id) : [];
  }

  destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
    }
    this.stopListeningForUserChanges?.();
    this.stopListeningForUserChanges = null;
    this.initialized = false;
  }

  private readonly handleOnline = (): void => {
    this.triggerSync();
  };

  private triggerSync(): void {
    void this.syncNow().catch((error: unknown) => {
      this.lastError.set(toErrorMessage(error));
    });
  }

  private async synchronize(): Promise<void> {
    this.lastError.set(null);

    if (!this.config.isSupabaseConfigured) {
      this.state.set('not-configured');
      return;
    }

    const user = this.auth.currentUser();
    if (!user) {
      this.state.set('signed-out');
      this.pendingCount.set(0);
      return;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.state.set('offline');
      return;
    }

    this.state.set('syncing');

    try {
      const pendingSets = await this.localStore.getPendingSets(user.id);
      this.pendingCount.set(pendingSets.length);

      for (const pending of pendingSets) {
        const { data, error } = await this.supabase.client.rpc('record_workout_set', {
          p_session_id: pending.set.workoutSessionId,
          p_exercise_id: pending.set.exerciseId,
          p_set_number: pending.set.setNumber,
          p_reps: pending.set.reps,
          p_weight_kg: pending.set.weightKg,
          p_is_failure: pending.set.isFailure,
          p_notes: pending.set.notes,
          p_performed_at: pending.set.performedAt,
          p_client_mutation_id: pending.mutationId,
        });

        if (error) {
          throw error;
        }

        const acknowledgement = parseAcknowledgement(data);
        await this.localStore.markSetSynced(
          user.id,
          pending.set.id,
          acknowledgement.workoutSetId,
          acknowledgement.eventId,
        );
        this.pendingCount.update((count) => count - 1);
      }

      this.state.set('idle');
    } catch (error) {
      this.state.set('error');
      this.lastError.set(toErrorMessage(error));
      throw error;
    }
  }
}

function parseAcknowledgement(value: unknown): RecordedSetAcknowledgement {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error('Supabase returned an invalid response for a recorded set');
  }

  const row: unknown = value[0];
  if (
    typeof row !== 'object' ||
    row === null ||
    !('workout_set_id' in row) ||
    typeof row.workout_set_id !== 'string' ||
    !('event_id' in row) ||
    typeof row.event_id !== 'string'
  ) {
    throw new Error('Supabase returned an invalid set or event ID');
  }

  return {
    workoutSetId: row.workout_set_id,
    eventId: row.event_id,
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Workout synchronization failed';
}
