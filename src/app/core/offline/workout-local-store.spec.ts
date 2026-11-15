import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { gymDatabase } from './gym-database';
import { WorkoutLocalStore } from './workout-local-store';

describe('WorkoutLocalStore', () => {
  const store = new WorkoutLocalStore();

  beforeEach(async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'local-set-1' });
    await gymDatabase.open();
    await gymDatabase.transaction('rw', gymDatabase.workoutSets, gymDatabase.syncOutbox, async () => {
      await gymDatabase.workoutSets.clear();
      await gymDatabase.syncOutbox.clear();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stores the set and its sync mutation together for offline upload', async () => {
    const savedSet = await store.recordSet('user-1', {
      workoutSessionId: 'session-1',
      exerciseId: 'exercise-1',
      setNumber: 1,
      reps: 8,
      weightKg: 42.5,
      isFailure: false,
    });

    expect(savedSet.syncStatus).toBe('pending');
    expect(savedSet.id).toBe('local-set-1');
    await expect(store.getPendingSets('user-1')).resolves.toEqual([{ mutationId: 'local-set-1', set: savedSet }]);
  });

  it('removes a successfully synced set from the outbox and is safe to retry', async () => {
    await store.recordSet('user-1', {
      workoutSessionId: 'session-1',
      exerciseId: 'exercise-1',
      setNumber: 1,
      reps: 8,
      weightKg: 42.5,
      isFailure: false,
    });

    await store.markSetSynced('user-1', 'local-set-1', 'server-set-1', 'server-event-1');
    await store.markSetSynced('user-1', 'local-set-1', 'server-set-1', 'server-event-1');

    expect(await gymDatabase.workoutSets.get('local-set-1')).toMatchObject({
      syncStatus: 'synced',
      serverSetId: 'server-set-1',
      serverEventId: 'server-event-1',
    });
    await expect(store.getPendingSets('user-1')).resolves.toEqual([]);
  });

  it('rejects invalid set values before writing to IndexedDB', async () => {
    await expect(
      store.recordSet('user-1', {
        workoutSessionId: 'session-1',
        exerciseId: 'exercise-1',
        setNumber: 1,
        reps: 0,
        weightKg: 42.5,
        isFailure: false,
      }),
    ).rejects.toThrow('Repetitions must be an integer between 1 and 1000');

    expect(await gymDatabase.workoutSets.count()).toBe(0);
    expect(await gymDatabase.syncOutbox.count()).toBe(0);
  });
});
