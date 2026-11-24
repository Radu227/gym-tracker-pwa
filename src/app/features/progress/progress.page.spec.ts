import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from '../../core/auth/auth.service';
import { ProgressService } from '../../core/progress/progress.service';
import { RoutineService, type Routine } from '../../core/routines/routine.service';
import { DailyWorkoutService, type DailyWorkoutLog } from '../../core/workouts/daily-workout.service';

import { ProgressPage } from './progress.page';

function makeRoutine(overrides: Partial<Routine> = {}): Routine {
  return {
    id: 'routine-1',
    user_id: 'user-1',
    name: 'Push',
    notes: 'Piept și umeri',
    sort_order: 0,
    created_at: '2026-11-10T10:00:00.000Z',
    updated_at: '2026-11-10T10:00:00.000Z',
    ...overrides,
  };
}

function makePastLog(overrides: Partial<DailyWorkoutLog> = {}): DailyWorkoutLog {
  return {
    id: 'log-past-1',
    user_id: 'user-1',
    workout_date: '2026-11-23',
    routine_id: 'routine-1',
    routine_name_snapshot: 'Push',
    mode: 'retroactive',
    status: 'completed',
    source: 'checkin',
    started_at: '2026-11-23T21:59:59.999Z',
    capture_at: '2026-11-23T21:59:59.999Z',
    completed_at: '2026-11-23T21:59:59.999Z',
    total_volume_kg: 1850,
    sets_snapshot: [],
    created_at: '2026-11-24T16:00:00.000Z',
    updated_at: '2026-11-24T16:00:00.000Z',
    ...overrides,
  };
}

describe('ProgressPage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  async function setup(): Promise<{
    component: ProgressPage;
    fixture: ComponentFixture<ProgressPage>;
    dailyWorkoutMock: {
      finalizeDueWorkouts: ReturnType<typeof vi.fn>;
      logPastWorkout: ReturnType<typeof vi.fn>;
    };
    progressMock: {
      listWorkoutDates: ReturnType<typeof vi.fn>;
      getStatistics: ReturnType<typeof vi.fn>;
    };
  }> {
    const dailyWorkoutMock = {
      finalizeDueWorkouts: vi.fn().mockResolvedValue([]),
      logPastWorkout: vi.fn().mockResolvedValue(makePastLog()),
    };
    const progressMock = {
      listWorkoutDates: vi.fn().mockResolvedValue(new Set(['2026-11-23'])),
      getStatistics: vi.fn().mockResolvedValue({
        totalVolume: 1850,
        monthlyWorkouts: 1,
        currentStreak: 0,
        progressingExercises: 0,
      }),
    };

    await TestBed.configureTestingModule({
      imports: [ProgressPage],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { currentUser: signal({ id: 'user-1' }) } },
        { provide: ProgressService, useValue: progressMock },
        {
          provide: RoutineService,
          useValue: {
            listForUser: vi
              .fn()
              .mockResolvedValue([makeRoutine({ id: 'r-1', name: 'Push' }), makeRoutine({ id: 'r-2', name: 'Pull' })]),
          },
        },
        { provide: DailyWorkoutService, useValue: dailyWorkoutMock },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ProgressPage);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
    fixture.detectChanges();

    return { component, fixture, dailyWorkoutMock, progressMock };
  }

  it('renders the missed-workout card below the calendar', async () => {
    const { fixture } = await setup();

    expect(fixture.nativeElement.textContent).toContain('Ai uitat să înregistrezi un antrenament?');
    expect(fixture.nativeElement.textContent).toContain('Apasă aici pentru a-l adăuga');
  });

  it('opens the modal with yesterday prefilled and saves a retroactive workout', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 24, 18, 0));

    const { component, fixture, dailyWorkoutMock, progressMock } = await setup();

    component.openMissedWorkoutModal();
    expect(component.isMissedModalOpen).toBe(true);
    expect(component.missedDate).toBe('2026-11-23');
    expect(component.selectedRoutineId).toBe('r-1');

    component.selectMissedRoutine('r-2');
    await component.saveMissedWorkout();
    fixture.detectChanges();

    expect(dailyWorkoutMock.logPastWorkout).toHaveBeenCalledWith('r-2', '2026-11-23');
    expect(component.isMissedModalOpen).toBe(false);
    expect(progressMock.listWorkoutDates).toHaveBeenCalledTimes(2);
    expect(component.missedSuccessMessage).toContain('Push');
    expect(component.missedSuccessMessage).toContain('23.11.2026');
  });
});
