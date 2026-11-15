import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from '../auth/auth.service';
import { WorkoutLocalStore } from '../offline/workout-local-store';
import { RuntimeConfigService } from '../supabase/runtime-config.service';
import { SupabaseClientService } from '../supabase/supabase-client.service';

import { WorkoutSyncService } from './workout-sync.service';

describe('WorkoutSyncService', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('uploads pending sets with their stable mutation ID and stores the server IDs', async () => {
    const pending = {
      mutationId: 'local-set-1',
      set: {
        id: 'local-set-1',
        userId: 'user-1',
        workoutSessionId: 'session-1',
        exerciseId: 'exercise-1',
        setNumber: 2,
        reps: 8,
        weightKg: 42.5,
        isFailure: false,
        notes: null,
        performedAt: '2026-11-14T17:00:00.000Z',
        createdAt: '2026-11-14T17:00:00.000Z',
        syncStatus: 'pending' as const,
      },
    };
    const rpc = vi.fn().mockResolvedValue({
      data: [{ workout_set_id: 'server-set-1', event_id: 'server-event-1' }],
      error: null,
    });
    const markSetSynced = vi.fn().mockResolvedValue(undefined);

    TestBed.configureTestingModule({
      providers: [
        WorkoutSyncService,
        { provide: AuthService, useValue: { currentUser: signal({ id: 'user-1' }) } },
        { provide: RuntimeConfigService, useValue: { isSupabaseConfigured: true } },
        {
          provide: WorkoutLocalStore,
          useValue: { getPendingSets: vi.fn().mockResolvedValue([pending]), markSetSynced },
        },
        { provide: SupabaseClientService, useValue: { client: { rpc } } },
      ],
    });

    await TestBed.inject(WorkoutSyncService).syncNow();

    expect(rpc).toHaveBeenCalledWith(
      'record_workout_set',
      expect.objectContaining({ p_client_mutation_id: 'local-set-1' }),
    );
    expect(markSetSynced).toHaveBeenCalledWith('user-1', 'local-set-1', 'server-set-1', 'server-event-1');
  });

  it('keeps the sync error visible and leaves a rejected upload unacknowledged', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: new Error('Session does not belong to this user'),
    });
    const markSetSynced = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        WorkoutSyncService,
        { provide: AuthService, useValue: { currentUser: signal({ id: 'user-1' }) } },
        { provide: RuntimeConfigService, useValue: { isSupabaseConfigured: true } },
        {
          provide: WorkoutLocalStore,
          useValue: {
            getPendingSets: vi.fn().mockResolvedValue([
              {
                mutationId: 'local-set-1',
                set: {
                  id: 'local-set-1',
                  workoutSessionId: 'session-1',
                  exerciseId: 'exercise-1',
                  setNumber: 1,
                  reps: 8,
                  weightKg: 42.5,
                  isFailure: false,
                  notes: null,
                  performedAt: '2026-11-14T17:00:00.000Z',
                },
              },
            ]),
            markSetSynced,
          },
        },
        { provide: SupabaseClientService, useValue: { client: { rpc } } },
      ],
    });

    const service = TestBed.inject(WorkoutSyncService);
    await expect(service.syncNow()).rejects.toThrow('Session does not belong to this user');

    expect(service.state()).toBe('error');
    expect(service.lastError()).toBe('Session does not belong to this user');
    expect(markSetSynced).not.toHaveBeenCalled();
  });

  it('reports an offline state without attempting a network request', async () => {
    const rpc = vi.fn();
    const originalOnline = navigator.onLine;
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });

    TestBed.configureTestingModule({
      providers: [
        WorkoutSyncService,
        { provide: AuthService, useValue: { currentUser: signal({ id: 'user-1' }) } },
        { provide: RuntimeConfigService, useValue: { isSupabaseConfigured: true } },
        { provide: WorkoutLocalStore, useValue: { getPendingSets: vi.fn(), markSetSynced: vi.fn() } },
        { provide: SupabaseClientService, useValue: { client: { rpc } } },
      ],
    });

    const service = TestBed.inject(WorkoutSyncService);
    await service.syncNow();

    expect(service.state()).toBe('offline');
    expect(rpc).not.toHaveBeenCalled();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: originalOnline });
  });
});
