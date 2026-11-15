import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService } from '../core/auth/auth.service';
import { RoutineService } from '../core/routines/routine.service';
import { WorkoutSyncService } from '../core/sync/workout-sync.service';

import { HomePage } from './home.page';

describe('HomePage', () => {
  let component: HomePage;
  let fixture: ComponentFixture<HomePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { currentUser: signal({ id: 'test-user' }) } },
        { provide: RoutineService, useValue: { listForUser: async () => [] } },
        { provide: WorkoutSyncService, useValue: { state: signal('idle'), pendingCount: signal(0) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HomePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
