import { ChangeDetectorRef, Component, inject } from '@angular/core';
import type { OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonList,
  IonNote,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';

import { AuthService } from '../core/auth/auth.service';
import { ProfileService, type Profile } from '../core/profile/profile.service';
import { ProgressService } from '../core/progress/progress.service';
import { RoutineService, type Routine } from '../core/routines/routine.service';
import { WorkoutSyncService } from '../core/sync/workout-sync.service';
import { TabsPage } from '../features/tabs/tabs.page';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [
    FormsModule,
    IonButton,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonCardTitle,
    IonContent,
    IonHeader,
    IonInput,
    IonItem,
    IonList,
    IonNote,
    IonSpinner,
    IonTitle,
    IonToolbar,
    TabsPage,
  ],
})
export class HomePage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly router = inject(Router);
  private readonly routinesService = inject(RoutineService);
  private readonly profileService = inject(ProfileService);
  private readonly progressService = inject(ProgressService);
  readonly sync = inject(WorkoutSyncService);

  routines: Routine[] = [];
  routineName = '';
  routineNotes = '';
  isLoading = true;
  isCreating = false;
  errorMessage: string | null = null;
  profile: Profile | null = null;
  hasWorkoutToday = false;
  isCheckingToday = true;

  async ngOnInit(): Promise<void> {
    await this.loadRoutines();
  }

  async ionViewWillEnter(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user || !this.profile) {
      return;
    }

    try {
      const [profile, hasWorkoutToday] = await Promise.all([
        this.profileService.getCurrentProfile(user.id),
        this.progressService.hasWorkoutToday(user.id),
      ]);
      this.profile = profile;
      this.hasWorkoutToday = hasWorkoutToday;
      this.isCheckingToday = false;
      this.changeDetector.detectChanges();
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Profilul nu a putut fi reîmprospătat.';
      this.isCheckingToday = false;
      this.changeDetector.detectChanges();
    }
  }

  async createRoutine(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) {
      await this.router.navigateByUrl('/auth', { replaceUrl: true });
      return;
    }

    this.errorMessage = null;
    this.isCreating = true;
    try {
      const routine = await this.routinesService.create(user.id, this.routineName, this.routineNotes);
      this.routines = [...this.routines, routine];
      this.routineName = '';
      this.routineNotes = '';
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Rutina nu a putut fi creată.';
    } finally {
      this.isCreating = false;
      this.changeDetector.detectChanges();
    }
  }

  async signOut(): Promise<void> {
    this.errorMessage = null;
    try {
      await this.auth.signOut();
      await this.router.navigateByUrl('/auth', { replaceUrl: true });
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Deconectarea nu a reușit.';
    }
  }

  openRoutine(routineId: string): void {
    void this.router.navigate(['/workouts', routineId]);
  }

  openHistory(): void {
    void this.router.navigateByUrl('/history');
  }

  openProfile(): void {
    void this.router.navigateByUrl('/profile');
  }

  openAchievements(): void {
    void this.router.navigateByUrl('/achievements');
  }

  openProgress(): void {
    void this.router.navigateByUrl('/progress');
  }

  openGraphs(): void {
    void this.router.navigateByUrl('/graphs');
  }

  async startTodayWorkout(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) {
      return;
    }

    this.errorMessage = null;
    try {
      await this.progressService.markAttendance(user.id);
      this.hasWorkoutToday = true;
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Prezența nu a putut fi salvată.';
      this.changeDetector.detectChanges();
      return;
    }

    const firstRoutine = this.routines[0];
    if (firstRoutine) {
      this.openRoutine(firstRoutine.id);
    }
    this.changeDetector.detectChanges();
  }

  private async loadRoutines(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) {
      await this.router.navigateByUrl('/auth', { replaceUrl: true });
      return;
    }

    this.isLoading = true;
    this.errorMessage = null;
    try {
      const [routines, profile, hasWorkoutToday] = await Promise.all([
        this.routinesService.listForUser(user.id),
        this.profileService.getCurrentProfile(user.id),
        this.progressService.hasWorkoutToday(user.id),
      ]);
      this.routines = routines;
      this.profile = profile;
      this.hasWorkoutToday = hasWorkoutToday;
      this.isCheckingToday = false;
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Rutinele nu au putut fi încărcate.';
    } finally {
      this.isLoading = false;
      this.isCheckingToday = false;
      this.changeDetector.detectChanges();
    }
  }

  get displayName(): string {
    const name = [this.profile?.first_name, this.profile?.last_name].filter(Boolean).join(' ');
    return name || 'Sportiv';
  }

  get encouragementMessage(): string {
    return 'Gata de antrenament?';
  }
}
