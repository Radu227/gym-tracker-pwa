import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from '../core/auth/auth.service';
import { ProfileService } from '../core/profile/profile.service';
import { RoutineService, type Routine } from '../core/routines/routine.service';
import { WorkoutSyncService } from '../core/sync/workout-sync.service';
import { DailyWorkoutService, type DailyWorkoutLog } from '../core/workouts/daily-workout.service';

import { HomePage } from './home.page';

function createRoutine(overrides: Partial<Routine> = {}): Routine {
  return {
    id: 'routine-1',
    user_id: 'test-user',
    name: 'Push',
    notes: 'Piept și umeri',
    sort_order: 0,
    created_at: '2026-11-16T10:00:00.000Z',
    updated_at: '2026-11-16T10:00:00.000Z',
    ...overrides,
  };
}

function createLog(overrides: Partial<DailyWorkoutLog> = {}): DailyWorkoutLog {
  return {
    id: 'log-1',
    user_id: 'test-user',
    workout_date: '2026-11-24',
    routine_id: 'routine-1',
    routine_name_snapshot: 'Push',
    mode: 'already_done',
    status: 'completed',
    source: 'checkin',
    started_at: '2026-11-24T12:00:00.000Z',
    capture_at: '2026-11-24T12:00:00.000Z',
    completed_at: '2026-11-24T12:00:00.000Z',
    total_volume_kg: 1200,
    sets_snapshot: [],
    created_at: '2026-11-24T12:00:00.000Z',
    updated_at: '2026-11-24T12:00:00.000Z',
    ...overrides,
  };
}

describe('HomePage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  async function setup(options?: {
    routines?: Routine[];
    activeLog?: DailyWorkoutLog | null;
    completedToday?: DailyWorkoutLog | null;
  }): Promise<{
    component: HomePage;
    fixture: ComponentFixture<HomePage>;
    dailyWorkoutMock: {
      getTodayState: ReturnType<typeof vi.fn>;
      logCompletedNow: ReturnType<typeof vi.fn>;
      startWorkout: ReturnType<typeof vi.fn>;
      finalizeWorkout: ReturnType<typeof vi.fn>;
      cancelWorkout: ReturnType<typeof vi.fn>;
    };
  }> {
    const routines = options?.routines ?? [createRoutine()];
    const dailyWorkoutMock = {
      getTodayState: vi.fn().mockResolvedValue({
        activeLog: options?.activeLog ?? null,
        completedToday: options?.completedToday ?? null,
      }),
      logCompletedNow: vi.fn().mockResolvedValue(createLog()),
      startWorkout: vi.fn().mockResolvedValue(
        createLog({
          mode: 'started_now',
          status: 'in_progress',
          capture_at: new Date(Date.now() + 3 * 3600 * 1000).toISOString(),
          completed_at: null,
          total_volume_kg: 0,
        }),
      ),
      finalizeWorkout: vi.fn().mockResolvedValue(createLog()),
      cancelWorkout: vi.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { currentUser: signal({ id: 'test-user' }) } },
        { provide: RoutineService, useValue: { listForUser: vi.fn().mockResolvedValue(routines) } },
        { provide: ProfileService, useValue: { getCurrentProfile: vi.fn().mockResolvedValue(null) } },
        { provide: DailyWorkoutService, useValue: dailyWorkoutMock },
        { provide: WorkoutSyncService, useValue: { state: signal('idle'), pendingCount: signal(0) } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(HomePage);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return { component, fixture, dailyWorkoutMock };
  }

  it('creates and displays both direct check-in options when no workout is logged today', async () => {
    const { component, fixture } = await setup();

    expect(component).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Ai tras azi de fiare?');
    expect(fixture.nativeElement.textContent).toContain('Am fost deja la sală');
    expect(fixture.nativeElement.textContent).toContain('Acum încep antrenamentul');
  });

  it('submits already-done check-in through the modal and hides the daily prompt', async () => {
    const { component, fixture, dailyWorkoutMock } = await setup({
      routines: [createRoutine({ id: 'r-push', name: 'Push' }), createRoutine({ id: 'r-pull', name: 'Pull' })],
    });

    component.openCheckinModal('already_done');
    expect(component.isCheckinModalOpen).toBe(true);
    expect(component.checkinMode).toBe('already_done');
    component.selectRoutine('r-pull');
    await component.confirmCheckin();
    fixture.detectChanges();

    expect(dailyWorkoutMock.logCompletedNow).toHaveBeenCalledWith('r-pull');
    expect(component.isCheckinModalOpen).toBe(false);
    expect(component.completedTodayLog).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Ai tras azi de fiare?');
  });

  it('displays the active 3-hour timer card when a workout is in progress', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-11-24T15:00:00.000Z');
    vi.setSystemTime(now);

    const activeLog = createLog({
      mode: 'started_now',
      status: 'in_progress',
      routine_name_snapshot: 'Legs',
      started_at: now.toISOString(),
      capture_at: new Date(now.getTime() + 3 * 3600 * 1000).toISOString(),
      completed_at: null,
      total_volume_kg: 0,
    });

    const { component, fixture } = await setup({ activeLog });

    expect(component.remainingTimeLabel).toBe('03:00:00');
    expect(fixture.nativeElement.textContent).toContain('Antrenament în desfășurare');
    expect(fixture.nativeElement.textContent).toContain('Legs');
    expect(fixture.nativeElement.textContent).toContain('03:00:00');
  });
});
