import { DecimalPipe } from '@angular/common';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import type { OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
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
  IonItem,
  IonList,
  IonModal,
  IonNote,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';

import { AuthService } from '../../core/auth/auth.service';
import { GoalService, type ExerciseGoal, type ExerciseOption } from '../../core/goals/goal.service';
import { TabsPage } from '../tabs/tabs.page';

@Component({
  selector: 'app-goals',
  templateUrl: './goals.page.html',
  styleUrl: './goals.page.scss',
  imports: [
    DecimalPipe,
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
    IonItem,
    IonList,
    IonModal,
    IonNote,
    IonSelect,
    IonSelectOption,
    IonTitle,
    IonToolbar,
    TabsPage,
  ],
})
export class GoalsPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly goalsService = inject(GoalService);
  private readonly router = inject(Router);

  goals: ExerciseGoal[] = [];
  exercises: ExerciseOption[] = [];
  isLoading = true;
  isSaving = false;
  isModalOpen = false;
  errorMessage: string | null = null;
  selectedExerciseId = '';
  targetWeightKg: number | null = null;
  targetReps: number | null = null;

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async ionViewWillEnter(): Promise<void> {
    if (!this.isLoading) {
      await this.load();
    }
  }

  openAddGoal(): void {
    this.errorMessage = null;
    this.selectedExerciseId = this.exercises[0]?.id ?? '';
    this.targetWeightKg = null;
    this.targetReps = null;
    this.isModalOpen = true;
  }

  closeAddGoal(): void {
    if (!this.isSaving) {
      this.isModalOpen = false;
    }
  }

  async saveGoal(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user || this.targetWeightKg === null || this.targetReps === null) {
      this.errorMessage = 'Alege exercițiul și completează greutatea și repetările țintă.';
      return;
    }

    this.isSaving = true;
    this.errorMessage = null;
    try {
      await this.goalsService.createGoal(user.id, this.selectedExerciseId, this.targetWeightKg, this.targetReps);
      this.isModalOpen = false;
      await this.load();
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Obiectivul nu a putut fi salvat.';
    } finally {
      this.isSaving = false;
      this.changeDetector.detectChanges();
    }
  }

  async deleteGoal(goal: ExerciseGoal): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) {
      return;
    }
    try {
      await this.goalsService.deleteGoal(user.id, goal.id);
      this.goals = this.goals.filter((item) => item.id !== goal.id);
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Obiectivul nu a putut fi șters.';
    } finally {
      this.changeDetector.detectChanges();
    }
  }

  private async load(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) {
      await this.router.navigateByUrl('/auth', { replaceUrl: true });
      return;
    }

    this.isLoading = true;
    this.errorMessage = null;
    try {
      [this.goals, this.exercises] = await Promise.all([
        this.goalsService.listGoals(user.id),
        this.goalsService.listExercises(user.id),
      ]);
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Obiectivele nu au putut fi încărcate.';
    } finally {
      this.isLoading = false;
      this.changeDetector.detectChanges();
    }
  }
}
