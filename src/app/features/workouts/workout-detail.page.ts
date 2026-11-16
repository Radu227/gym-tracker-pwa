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
  IonList,
  IonNote,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { createOutline, trashOutline } from 'ionicons/icons';

import { AuthService } from '../../core/auth/auth.service';
import {
  RoutineDetailService,
  type MuscleGroup,
  type RoutineExercise,
  type SameNamedMuscleGroup,
} from '../../core/routines/routine-detail.service';
import { RoutineService, type Routine } from '../../core/routines/routine.service';

interface MuscleGroupView extends MuscleGroup {
  exercises: RoutineExercise[];
  exerciseName: string;
  isAddingExercise: boolean;
  isPending?: boolean;
}

@Component({
  selector: 'app-workout-detail',
  templateUrl: './workout-detail.page.html',
  styleUrl: './workout-detail.page.scss',
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
    IonList,
    IonNote,
    IonTitle,
    IonToolbar,
  ],
})
export class WorkoutDetailPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly detailService = inject(RoutineDetailService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly routineService = inject(RoutineService);

  routine: Routine | null = null;
  groups: MuscleGroupView[] = [];
  groupName = '';
  isLoading = true;
  isAddingGroup = false;
  errorMessage: string | null = null;
  readonly editIcon = createOutline;
  readonly deleteIcon = trashOutline;

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async addGroup(): Promise<void> {
    const user = this.auth.currentUser();
    const routineId = this.route.snapshot.paramMap.get('routineId');
    if (!user || !routineId) {
      await this.router.navigateByUrl('/auth', { replaceUrl: true });
      return;
    }

    this.errorMessage = null;
    const name = this.groupName.trim();
    let sameNamedGroup: SameNamedMuscleGroup | null;
    try {
      sameNamedGroup = await this.detailService.findSameNamedGroup(user.id, routineId, name);
    } catch (error) {
      this.errorMessage = toErrorMessage(error, 'Grupa musculară nu a putut fi verificată.');
      this.changeDetector.detectChanges();
      return;
    }
    if (
      sameNamedGroup &&
      typeof window !== 'undefined' &&
      !window.confirm(
        `Grupa „${name}” există deja într-un alt antrenament. Dacă o folosești, exercițiile și istoricul lor vor fi aceleași. Continui?`,
      )
    ) {
      return;
    }

    const optimisticGroup: MuscleGroupView = {
      id: `local-group-${crypto.randomUUID()}`,
      routine_id: routineId,
      user_id: user.id,
      name,
      sort_order: this.groups.length,
      exercises: [],
      exerciseName: '',
      isAddingExercise: false,
      isPending: true,
    };
    this.groups = [...this.groups, optimisticGroup];
    this.groupName = '';
    this.isAddingGroup = false;

    try {
      const group = await this.detailService.createMuscleGroup(user.id, routineId, name, sameNamedGroup?.id);
      const exercises = sameNamedGroup ? await this.detailService.listExercises(user.id, group.id) : [];
      this.groups = this.groups.map((item) =>
        item.id === optimisticGroup.id ? { ...group, exercises, exerciseName: '', isAddingExercise: false } : item,
      );
    } catch (error) {
      this.groups = this.groups.filter((item) => item.id !== optimisticGroup.id);
      this.errorMessage = toErrorMessage(error, 'Grupa musculară nu a putut fi adăugată.');
    }
    this.changeDetector.detectChanges();
  }

  async addExercise(group: MuscleGroupView): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) {
      await this.router.navigateByUrl('/auth', { replaceUrl: true });
      return;
    }

    this.errorMessage = null;
    const name = group.exerciseName.trim();
    if (!name) {
      return;
    }

    try {
      const existingExercise = await this.detailService.findExistingExerciseGroups(user.id, name);
      if (existingExercise) {
        const groups = existingExercise.muscleGroups.join(', ') || 'o altă grupă musculară';
        if (typeof window !== 'undefined') {
          window.alert(
            `Exercițiul „${existingExercise.exerciseName}” apare deja la grupa ${groups}. ` +
              'Pentru o execuție diferită, introdu un nume diferit.',
          );
        }
        return;
      }
    } catch (error) {
      this.errorMessage = toErrorMessage(error, 'Exercițiul nu a putut fi verificat.');
      this.changeDetector.detectChanges();
      return;
    }

    const localExerciseId = `local-exercise-${crypto.randomUUID()}`;
    const optimisticExercise: RoutineExercise = {
      id: localExerciseId,
      muscle_group_id: group.id,
      exercise_id: localExerciseId,
      sort_order: group.exercises.length,
      exercise: {
        id: localExerciseId,
        name,
        primary_muscle_group: group.name,
      },
    };
    group.exercises = [...group.exercises, optimisticExercise];
    group.exerciseName = '';
    group.isAddingExercise = false;

    try {
      const exercise = await this.detailService.createExercise(user.id, group.id, name);
      group.exercises = group.exercises.map((item) => (item.id === optimisticExercise.id ? exercise : item));
    } catch (error) {
      group.exercises = group.exercises.filter((item) => item.id !== optimisticExercise.id);
      this.errorMessage = toErrorMessage(error, 'Exercițiul nu a putut fi adăugat.');
    }
    this.changeDetector.detectChanges();
  }

  async editGroup(group: MuscleGroupView): Promise<void> {
    const name = typeof window !== 'undefined' ? window.prompt('Numele grupei musculare', group.name) : null;
    if (name === null) {
      return;
    }

    const user = this.auth.currentUser();
    if (!user) {
      return;
    }
    try {
      const updated = await this.detailService.updateMuscleGroup(user.id, group.id, name);
      this.groups = this.groups.map((item) => (item.id === group.id ? { ...item, name: updated.name } : item));
    } catch (error) {
      this.errorMessage = toErrorMessage(error, 'Grupa musculară nu a putut fi modificată.');
    } finally {
      this.changeDetector.detectChanges();
    }
  }

  async deleteGroup(group: MuscleGroupView): Promise<void> {
    if (typeof window !== 'undefined' && !window.confirm(`Ștergi grupa „${group.name}” și exercițiile ei?`)) {
      return;
    }
    const user = this.auth.currentUser();
    if (!user) {
      return;
    }

    try {
      await this.detailService.deleteMuscleGroup(user.id, group.id);
      this.groups = this.groups.filter((item) => item.id !== group.id);
    } catch (error) {
      this.errorMessage = toErrorMessage(error, 'Grupa musculară nu a putut fi ștearsă.');
    } finally {
      this.changeDetector.detectChanges();
    }
  }

  async editExercise(group: MuscleGroupView, item: RoutineExercise): Promise<void> {
    const name = typeof window !== 'undefined' ? window.prompt('Numele exercițiului', item.exercise.name) : null;
    if (name === null) {
      return;
    }
    const user = this.auth.currentUser();
    if (!user) {
      return;
    }

    try {
      const updated = await this.detailService.updateExercise(user.id, item.exercise_id, name);
      group.exercises = group.exercises.map((exercise) =>
        exercise.exercise_id === item.exercise_id ? { ...exercise, exercise: updated } : exercise,
      );
    } catch (error) {
      this.errorMessage = toErrorMessage(error, 'Exercițiul nu a putut fi modificat.');
    } finally {
      this.changeDetector.detectChanges();
    }
  }

  async deleteExercise(group: MuscleGroupView, item: RoutineExercise): Promise<void> {
    if (typeof window !== 'undefined' && !window.confirm(`Ștergi exercițiul „${item.exercise.name}” din grupă?`)) {
      return;
    }
    const user = this.auth.currentUser();
    if (!user) {
      return;
    }

    try {
      await this.detailService.deleteExerciseFromGroup(user.id, item.id, group.id);
      group.exercises = group.exercises.filter((exercise) => exercise.id !== item.id);
    } catch (error) {
      this.errorMessage = toErrorMessage(error, 'Exercițiul nu a putut fi șters din grupă.');
    } finally {
      this.changeDetector.detectChanges();
    }
  }

  async openExercise(exercise: RoutineExercise): Promise<void> {
    await this.router.navigate(['/workout-session', this.routine?.id, exercise.exercise_id]);
  }

  private async load(): Promise<void> {
    const user = this.auth.currentUser();
    const routineId = this.route.snapshot.paramMap.get('routineId');
    if (!user || !routineId) {
      await this.router.navigateByUrl('/auth', { replaceUrl: true });
      return;
    }

    this.isLoading = true;
    try {
      const [routines, groups] = await Promise.all([
        this.routineService.listForUser(user.id),
        this.detailService.listMuscleGroups(user.id, routineId),
      ]);
      this.routine = routines.find((item) => item.id === routineId) ?? null;
      if (!this.routine) {
        throw new Error('Antrenamentul nu a fost găsit.');
      }

      this.groups = await Promise.all(
        groups.map(async (group) => ({
          ...group,
          exercises: await this.detailService.listExercises(user.id, group.id),
          exerciseName: '',
          isAddingExercise: false,
        })),
      );
    } catch (error) {
      this.errorMessage = toErrorMessage(error, 'Detaliile antrenamentului nu au putut fi încărcate.');
    } finally {
      this.isLoading = false;
      this.changeDetector.detectChanges();
    }
  }
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return fallback;
}
