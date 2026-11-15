import Dexie, { type EntityTable } from 'dexie';

export type WorkoutSetSyncStatus = 'pending' | 'synced';

export interface LocalWorkoutSet {
  id: string;
  userId: string;
  workoutSessionId: string;
  exerciseId: string;
  setNumber: number;
  reps: number;
  weightKg: number;
  isFailure: boolean;
  notes: string | null;
  performedAt: string;
  createdAt: string;
  syncStatus: WorkoutSetSyncStatus;
  serverSetId?: string;
  serverEventId?: string;
}

export interface SetSyncOutboxEntry {
  id: string;
  userId: string;
  kind: 'record_workout_set';
  createdAt: string;
  attempts: number;
}

export class GymDatabase extends Dexie {
  workoutSets!: EntityTable<LocalWorkoutSet, 'id'>;
  syncOutbox!: EntityTable<SetSyncOutboxEntry, 'id'>;

  constructor(name = 'sala-tracker') {
    super(name);

    this.version(1).stores({
      workoutSets:
        '&id,userId,workoutSessionId,exerciseId,performedAt,syncStatus,[userId+workoutSessionId],[userId+exerciseId+performedAt],[userId+syncStatus]',
      syncOutbox: '&id,userId,kind,createdAt,[userId+createdAt]',
    });
  }
}

export const gymDatabase = new GymDatabase();
