import { ChangeDetectorRef, Component, inject } from '@angular/core';
import type { OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonInput,
  IonIcon,
  IonItem,
  IonNote,
  IonTitle,
  IonToggle,
  IonToolbar,
} from '@ionic/angular';
import { trashOutline } from 'ionicons/icons';

import { AuthService } from '../../core/auth/auth.service';
import { RoutineService } from '../../core/routines/routine.service';
import { WorkoutSyncService } from '../../core/sync/workout-sync.service';
import {
  WorkoutSessionService,
  type CurrentWorkoutSet,
  type ExerciseSummary,
  type WorkoutSession,
} from '../../core/workouts/workout-session.service';

interface SetRow {
  rowId: string;
  setNumber: number;
  reps: number;
  weightKg: number;
  isFailure: boolean;
  notes: string;
  originalReps: number;
  originalWeightKg: number;
  originalIsFailure: boolean;
  originalNotes: string;
  source?: CurrentWorkoutSet;
  localId?: string;
  saving: boolean;
}

@Component({
  selector: 'app-workout-session',
  templateUrl: './workout-session.page.html',
  styleUrl: './workout-session.page.scss',
  imports: [
    FormsModule,
    IonBackButton,
    IonButton,
    IonButtons,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonCardTitle,
    IonContent,
    IonHeader,
    IonInput,
    IonIcon,
    IonItem,
    IonNote,
    IonTitle,
    IonToggle,
    IonToolbar,
  ],
})
export class WorkoutSessionPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly routineService = inject(RoutineService);
  private readonly sessionService = inject(WorkoutSessionService);
  private readonly syncService = inject(WorkoutSyncService);

  exercise: ExerciseSummary | null = null;
  session: WorkoutSession | null = null;
  sets: SetRow[] = [];
  newSet: SetRow | null = null;
  isLoading = true;
  errorMessage: string | null = null;
  readonly deleteIcon = trashOutline;
  async ngOnInit(): Promise<void> {
    await this.load();
  }

  addSet(): void {
    if (this.newSet) {
      return;
    }
    const previous = this.sets[this.sets.length - 1];
    const nextSetNumber = this.sets.reduce((maximum, set) => Math.max(maximum, set.setNumber), 0) + 1;
    this.newSet = {
      rowId: `new-${crypto.randomUUID()}`,
      setNumber: nextSetNumber,
      reps: previous?.reps ?? 8,
      weightKg: previous?.weightKg ?? 0,
      isFailure: false,
      notes: '',
      originalReps: previous?.reps ?? 8,
      originalWeightKg: previous?.weightKg ?? 0,
      originalIsFailure: false,
      originalNotes: '',
      saving: false,
    };
  }

  cancelNewSet(): void {
    this.newSet = null;
  }

  async saveNewSet(): Promise<void> {
    if (!this.session || !this.exercise || !this.newSet || this.newSet.saving) {
      return;
    }

    this.errorMessage = null;
    const set = this.newSet;
    set.saving = true;
    try {
      const localSet = await this.syncService.recordSet({
        workoutSessionId: this.session.id,
        exerciseId: this.exercise.id,
        setNumber: set.setNumber,
        reps: Number(set.reps),
        weightKg: Number(set.weightKg),
        isFailure: set.isFailure,
        notes: set.notes,
      });
      set.localId = localSet.id;
      set.rowId = localSet.id;
      this.sets = [...this.sets, set].sort((left, right) => left.setNumber - right.setNumber);
      this.newSet = null;
    } catch (error) {
      this.errorMessage = toErrorMessage(error, 'Seria nu a putut fi salvată.');
    } finally {
      set.saving = false;
      this.changeDetector.detectChanges();
    }
  }

  isDirty(set: SetRow): boolean {
    return (
      set.reps !== set.originalReps ||
      set.weightKg !== set.originalWeightKg ||
      set.isFailure !== set.originalIsFailure ||
      set.notes !== set.originalNotes
    );
  }

  async saveChanges(set: SetRow): Promise<void> {
    if (!set.source || !this.isDirty(set) || set.saving) {
      return;
    }

    set.saving = true;
    this.errorMessage = null;
    try {
      const eventId = await this.sessionService.correctSet(set.source, {
        reps: Number(set.reps),
        weight_kg: Number(set.weightKg),
        is_failure: set.isFailure,
        notes: set.notes.trim() || null,
      });
      set.source = { ...set.source, current_event_id: eventId };
      set.originalReps = set.reps;
      set.originalWeightKg = set.weightKg;
      set.originalIsFailure = set.isFailure;
      set.originalNotes = set.notes;
    } catch (error) {
      this.errorMessage = toErrorMessage(error, 'Modificările nu au putut fi salvate.');
    } finally {
      set.saving = false;
      this.changeDetector.detectChanges();
    }
  }

  async deleteSet(set: SetRow): Promise<void> {
    if (set.saving || (typeof window !== 'undefined' && !window.confirm(`Ștergi Seria ${set.setNumber}?`))) {
      return;
    }

    set.saving = true;
    this.errorMessage = null;
    try {
      if (set.source) {
        await this.sessionService.voidSet(set.source);
      } else if (set.localId) {
        const localSet = await this.syncService.getLocalSet(set.localId);
        if (!localSet) {
          throw new Error('Seria locală nu mai există.');
        }
        if (localSet.syncStatus === 'pending') {
          await this.syncService.deletePendingSet(set.localId);
        } else if (localSet.serverSetId && localSet.serverEventId) {
          await this.sessionService.voidSet({
            workout_set_id: localSet.serverSetId,
            current_event_id: localSet.serverEventId,
            session_id: localSet.workoutSessionId,
            exercise_id: localSet.exerciseId,
            set_number: localSet.setNumber,
            reps: localSet.reps,
            weight_kg: localSet.weightKg,
            is_failure: localSet.isFailure,
            is_voided: false,
            notes: localSet.notes,
            performed_at: localSet.performedAt,
          });
        }
      }
      this.sets = this.sets.filter((item) => item.rowId !== set.rowId);
    } catch (error) {
      this.errorMessage = toErrorMessage(error, 'Seria nu a putut fi ștearsă.');
    } finally {
      set.saving = false;
      this.changeDetector.detectChanges();
    }
  }

  private async load(): Promise<void> {
    const user = this.auth.currentUser();
    const routineId = this.route.snapshot.paramMap.get('routineId');
    const exerciseId = this.route.snapshot.paramMap.get('exerciseId');
    if (!user || !routineId || !exerciseId) {
      await this.router.navigateByUrl('/auth', { replaceUrl: true });
      return;
    }

    try {
      const [routines, exercise] = await Promise.all([
        this.routineService.listForUser(user.id),
        this.sessionService.getExercise(user.id, exerciseId),
      ]);
      const routine = routines.find((item) => item.id === routineId);
      if (!routine) {
        throw new Error('Antrenamentul nu a fost găsit.');
      }

      this.exercise = exercise;
      this.session = await this.sessionService.createSession(user.id, routineId, routine.name);
      this.isLoading = false;
      this.changeDetector.detectChanges();

      try {
        const previousSets = await this.sessionService.listLastSets(user.id, exerciseId);
        if (previousSets.length > 0) {
          this.sets = previousSets.map(toSetRow);
        }
      } catch {
        this.errorMessage = 'Istoricul ultimei sesiuni nu este disponibil momentan. Poți continua cu o serie nouă.';
      }
      this.changeDetector.detectChanges();
    } catch (error) {
      this.errorMessage = toErrorMessage(error, 'Sesiunea nu a putut fi pornită.');
    } finally {
      this.isLoading = false;
      this.changeDetector.detectChanges();
    }
  }
}

function toSetRow(set: CurrentWorkoutSet): SetRow {
  return {
    rowId: set.workout_set_id,
    setNumber: set.set_number,
    reps: set.reps,
    weightKg: Number(set.weight_kg),
    isFailure: set.is_failure,
    notes: set.notes ?? '',
    originalReps: set.reps,
    originalWeightKg: Number(set.weight_kg),
    originalIsFailure: set.is_failure,
    originalNotes: set.notes ?? '',
    source: set,
    saving: false,
  };
}

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
