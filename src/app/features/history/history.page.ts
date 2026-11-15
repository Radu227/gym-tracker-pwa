import { ChangeDetectorRef, Component, inject } from '@angular/core';
import type { OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonBackButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';

import { AuthService } from '../../core/auth/auth.service';
import {
  WorkoutSessionService,
  type ExerciseOption,
  type WorkoutSetHistoryEntry,
} from '../../core/workouts/workout-session.service';

@Component({
  selector: 'app-history',
  templateUrl: './history.page.html',
  styleUrl: './history.page.scss',
  imports: [
    FormsModule,
    IonBackButton,
    IonButtons,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonCardTitle,
    IonContent,
    IonHeader,
    IonItem,
    IonLabel,
    IonList,
    IonNote,
    IonSelect,
    IonSelectOption,
    IonTitle,
    IonToolbar,
  ],
})
export class HistoryPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly router = inject(Router);
  private readonly sessionService = inject(WorkoutSessionService);

  exercises: ExerciseOption[] = [];
  selectedExerciseId = '';
  history: WorkoutSetHistoryEntry[] = [];
  isLoading = true;
  isLoadingHistory = false;
  errorMessage: string | null = null;

  async ngOnInit(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) {
      await this.router.navigateByUrl('/auth', { replaceUrl: true });
      return;
    }

    try {
      this.exercises = await this.sessionService.listExercises(user.id);
      if (this.exercises.length > 0) {
        this.selectedExerciseId = this.exercises[0].id;
        await this.loadHistory();
      }
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Istoricul nu a putut fi încărcat.';
    } finally {
      this.isLoading = false;
      this.changeDetector.detectChanges();
    }
  }

  async onExerciseChanged(): Promise<void> {
    await this.loadHistory();
  }

  formatDate(value: string): string {
    return new Intl.DateTimeFormat('ro-RO', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  }

  private async loadHistory(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user || !this.selectedExerciseId) {
      return;
    }

    this.isLoadingHistory = true;
    this.errorMessage = null;
    try {
      this.history = await this.sessionService.listHistory(user.id, this.selectedExerciseId);
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Istoricul exercițiului nu a putut fi încărcat.';
    } finally {
      this.isLoadingHistory = false;
      this.changeDetector.detectChanges();
    }
  }
}
