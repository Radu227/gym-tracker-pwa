import { Injectable } from '@angular/core';
import Dexie from 'dexie';

import { gymDatabase, type LocalWorkoutSet, type SetSyncOutboxEntry } from './gym-database';

export interface RecordWorkoutSetInput {
  workoutSessionId: string;
  exerciseId: string;
  setNumber: number;
  reps: number;
  weightKg: number;
  isFailure: boolean;
  notes?: string | null;
  performedAt?: Date;
}

export interface PendingWorkoutSet {
  mutationId: string;
  set: LocalWorkoutSet;
}

@Injectable({ providedIn: 'root' })
export class WorkoutLocalStore {
  private readonly database = gymDatabase;

  async recordSet(userId: string, input: RecordWorkoutSetInput): Promise<LocalWorkoutSet> {
    this.validateInput(userId, input);

    const now = new Date().toISOString();
    const set: LocalWorkoutSet = {
      id: crypto.randomUUID(),
      userId,
      workoutSessionId: input.workoutSessionId,
      exerciseId: input.exerciseId,
      setNumber: input.setNumber,
      reps: input.reps,
      weightKg: input.weightKg,
      isFailure: input.isFailure,
      notes: input.notes?.trim() || null,
      performedAt: (input.performedAt ?? new Date()).toISOString(),
      createdAt: now,
      syncStatus: 'pending',
    };
    const outboxEntry: SetSyncOutboxEntry = {
      id: set.id,
      userId,
      kind: 'record_workout_set',
      createdAt: now,
      attempts: 0,
    };

    await this.database.transaction('rw', this.database.workoutSets, this.database.syncOutbox, async () => {
      await this.database.workoutSets.add(set);
      await this.database.syncOutbox.add(outboxEntry);
    });

    return set;
  }

  async getPendingSets(userId: string): Promise<PendingWorkoutSet[]> {
    const entries = await this.database.syncOutbox
      .where('[userId+createdAt]')
      .between([userId, Dexie.minKey], [userId, Dexie.maxKey])
      .toArray();

    const pending: PendingWorkoutSet[] = [];
    for (const entry of entries) {
      const set = await this.database.workoutSets.get(entry.id);
      if (!set || set.userId !== userId || set.syncStatus !== 'pending') {
        throw new Error(`Offline sync queue is inconsistent for set ${entry.id}`);
      }
      pending.push({ mutationId: entry.id, set });
    }

    return pending;
  }

  async listSets(userId: string): Promise<LocalWorkoutSet[]> {
    return this.database.workoutSets.where('userId').equals(userId).toArray();
  }

  async markSetSynced(userId: string, setId: string, serverSetId: string, serverEventId: string): Promise<void> {
    if (!userId.trim() || !setId.trim() || !serverSetId.trim() || !serverEventId.trim()) {
      throw new Error('User, local set, server set, and server event IDs are required');
    }

    await this.database.transaction('rw', this.database.workoutSets, this.database.syncOutbox, async () => {
      const set = await this.database.workoutSets.get(setId);
      if (!set || set.userId !== userId) {
        throw new Error(`Workout set ${setId} was not found for the current user`);
      }

      if (set.syncStatus === 'synced') {
        if (set.serverSetId !== serverSetId || set.serverEventId !== serverEventId) {
          throw new Error(`Workout set ${setId} was acknowledged with different server IDs`);
        }
        return;
      }

      const outboxEntry = await this.database.syncOutbox.get(setId);
      if (!outboxEntry || outboxEntry.userId !== userId) {
        throw new Error(`Offline sync queue is missing for set ${setId}`);
      }

      await this.database.workoutSets.update(setId, {
        syncStatus: 'synced',
        serverSetId,
        serverEventId,
      });
      await this.database.syncOutbox.delete(setId);
    });
  }

  private validateInput(userId: string, input: RecordWorkoutSetInput): void {
    if (!userId.trim() || !input.workoutSessionId.trim() || !input.exerciseId.trim()) {
      throw new Error('User, workout session, and exercise IDs are required');
    }
    if (!Number.isInteger(input.setNumber) || input.setNumber < 1 || input.setNumber > 100) {
      throw new Error('Set number must be an integer between 1 and 100');
    }
    if (!Number.isInteger(input.reps) || input.reps < 1 || input.reps > 1000) {
      throw new Error('Repetitions must be an integer between 1 and 1000');
    }
    if (!Number.isFinite(input.weightKg) || input.weightKg < 0) {
      throw new Error('Weight must be a non-negative number');
    }
    if (input.notes && input.notes.length > 2000) {
      throw new Error('Set notes cannot exceed 2000 characters');
    }
    if (input.performedAt && Number.isNaN(input.performedAt.getTime())) {
      throw new Error('Performed-at date is invalid');
    }
  }
}
