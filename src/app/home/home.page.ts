import { ChangeDetectorRef, Component, inject } from '@angular/core';
import type { OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonList,
  IonModal,
  IonNote,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { createOutline, trashOutline } from 'ionicons/icons';

import { AuthService } from '../core/auth/auth.service';
import { ProfileService, type Profile } from '../core/profile/profile.service';
import { RoutineService, type Routine } from '../core/routines/routine.service';
import { WorkoutSyncService } from '../core/sync/workout-sync.service';
import {
  DailyWorkoutService,
  formatCountdown,
  type DailyWorkoutLog,
  type TodayWorkoutState,
} from '../core/workouts/daily-workout.service';
import { TabsPage } from '../features/tabs/tabs.page';

type CheckinMode = 'already_done' | 'started_now';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [
    FormsModule,
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
    IonModal,
    IonNote,
    IonSpinner,
    IonTitle,
    IonToolbar,
    TabsPage,
  ],
})
export class HomePage implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly router = inject(Router);
  private readonly routinesService = inject(RoutineService);
  private readonly profileService = inject(ProfileService);
  private readonly dailyWorkoutService = inject(DailyWorkoutService);
  readonly sync = inject(WorkoutSyncService);

  routines: Routine[] = [];
  routineName = '';
  routineNotes = '';
  isLoading = true;
  isCreating = false;
  errorMessage: string | null = null;
  profile: Profile | null = null;

  activeWorkoutLog: DailyWorkoutLog | null = null;
  completedTodayLog: DailyWorkoutLog | null = null;
  isCheckingToday = true;
  remainingTimeLabel = '03:00:00';

  isCheckinModalOpen = false;
  checkinMode: CheckinMode | null = null;
  selectedRoutineId: string | null = null;
  checkinErrorMessage: string | null = null;
  isSubmittingCheckin = false;
  isUpdatingActiveLog = false;

  readonly editIcon = createOutline;
  readonly deleteIcon = trashOutline;

  private hasLoadedOnce = false;
  private isViewActive = false;
  private isAutoFinalizing = false;
  private countdownIntervalId: ReturnType<typeof setInterval> | null = null;
  private visibilityListenerAttached = false;

  private readonly handleVisibilityChange = (): void => {
    if (
      typeof document === 'undefined' ||
      document.visibilityState !== 'visible' ||
      !this.isViewActive ||
      !this.activeWorkoutLog?.capture_at
    ) {
      return;
    }

    const remainingMs = new Date(this.activeWorkoutLog.capture_at).getTime() - Date.now();
    this.remainingTimeLabel = formatCountdown(remainingMs);
    if (remainingMs <= 0) {
      this.stopCountdown();
      void this.autoFinalizeDueWorkout();
    } else {
      this.changeDetector.detectChanges();
    }
  };

  async ngOnInit(): Promise<void> {
    this.isViewActive = true;
    this.attachVisibilityListener();
    await this.loadHomeData();
    this.hasLoadedOnce = true;
  }

  async ionViewWillEnter(): Promise<void> {
    this.isViewActive = true;
    this.attachVisibilityListener();
    if (!this.hasLoadedOnce) {
      return;
    }
    await this.refreshHomeData();
  }

  ionViewWillLeave(): void {
    this.isViewActive = false;
    this.stopCountdown();
    this.detachVisibilityListener();
  }

  ngOnDestroy(): void {
    this.isViewActive = false;
    this.stopCountdown();
    this.detachVisibilityListener();
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
      this.errorMessage = toErrorMessage(error, 'Rutina nu a putut fi creată.');
    } finally {
      this.isCreating = false;
      this.changeDetector.detectChanges();
    }
  }

  async editRoutine(routine: Routine): Promise<void> {
    const name = typeof window !== 'undefined' ? window.prompt('Numele antrenamentului', routine.name) : null;
    if (name === null) {
      return;
    }
    const notes = typeof window !== 'undefined' ? window.prompt('Notițe (opțional)', routine.notes ?? '') : null;
    if (notes === null) {
      return;
    }

    this.errorMessage = null;
    try {
      const updated = await this.routinesService.update(this.auth.currentUser()!.id, routine.id, name, notes);
      this.routines = this.routines.map((item) => (item.id === routine.id ? updated : item));
    } catch (error) {
      this.errorMessage = toErrorMessage(error, 'Rutina nu a putut fi modificată.');
    } finally {
      this.changeDetector.detectChanges();
    }
  }

  async deleteRoutine(routine: Routine): Promise<void> {
    if (typeof window !== 'undefined' && !window.confirm(`Ștergi antrenamentul „${routine.name}”?`)) {
      return;
    }

    this.errorMessage = null;
    try {
      await this.routinesService.delete(this.auth.currentUser()!.id, routine.id);
      this.routines = this.routines.filter((item) => item.id !== routine.id);
    } catch (error) {
      this.errorMessage = toErrorMessage(error, 'Antrenamentul nu a putut fi șters.');
    } finally {
      this.changeDetector.detectChanges();
    }
  }

  async signOut(): Promise<void> {
    this.errorMessage = null;
    try {
      await this.auth.signOut();
      await this.router.navigateByUrl('/auth', { replaceUrl: true });
    } catch (error) {
      this.errorMessage = toErrorMessage(error, 'Deconectarea nu a reușit.');
    }
  }

  openRoutine(routineId: string): void {
    void this.router.navigate(['/workouts', routineId]);
  }

  openActiveRoutine(): void {
    if (this.activeWorkoutLog?.routine_id) {
      this.openRoutine(this.activeWorkoutLog.routine_id);
    }
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

  openCheckinModal(mode: CheckinMode): void {
    this.errorMessage = null;
    this.checkinErrorMessage = null;
    this.checkinMode = mode;
    this.selectedRoutineId = this.routines[0]?.id ?? null;
    this.isCheckinModalOpen = true;
  }

  closeCheckinModal(): void {
    if (this.isSubmittingCheckin) {
      return;
    }
    this.isCheckinModalOpen = false;
    this.checkinMode = null;
    this.checkinErrorMessage = null;
  }

  selectRoutine(routineId: string): void {
    this.selectedRoutineId = routineId;
    this.checkinErrorMessage = null;
  }

  async confirmCheckin(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) {
      await this.router.navigateByUrl('/auth', { replaceUrl: true });
      return;
    }
    if (!this.checkinMode || !this.selectedRoutineId || this.isSubmittingCheckin) {
      return;
    }

    this.isSubmittingCheckin = true;
    this.checkinErrorMessage = null;
    this.errorMessage = null;
    try {
      if (this.checkinMode === 'already_done') {
        const log = await this.dailyWorkoutService.logCompletedNow(this.selectedRoutineId);
        this.applyTodayState({ activeLog: null, completedToday: log });
      } else {
        const log = await this.dailyWorkoutService.startWorkout(this.selectedRoutineId);
        this.applyTodayState({ activeLog: log, completedToday: null });
      }
      this.isCheckinModalOpen = false;
      this.checkinMode = null;
    } catch (error) {
      this.checkinErrorMessage = toErrorMessage(error, 'Antrenamentul nu a putut fi înregistrat.');
    } finally {
      this.isSubmittingCheckin = false;
      this.changeDetector.detectChanges();
    }
  }

  async finalizeActiveWorkout(): Promise<void> {
    if (!this.activeWorkoutLog || this.isUpdatingActiveLog) {
      return;
    }

    this.isUpdatingActiveLog = true;
    this.errorMessage = null;
    try {
      const finalized = await this.dailyWorkoutService.finalizeWorkout(this.activeWorkoutLog.id);
      this.applyTodayState({ activeLog: null, completedToday: finalized });
    } catch (error) {
      this.errorMessage = toErrorMessage(error, 'Antrenamentul nu a putut fi finalizat.');
    } finally {
      this.isUpdatingActiveLog = false;
      this.changeDetector.detectChanges();
    }
  }

  async cancelActiveWorkout(): Promise<void> {
    if (!this.activeWorkoutLog || this.isUpdatingActiveLog) {
      return;
    }
    if (typeof window !== 'undefined' && !window.confirm('Anulezi antrenamentul în desfășurare?')) {
      return;
    }

    this.isUpdatingActiveLog = true;
    this.errorMessage = null;
    try {
      await this.dailyWorkoutService.cancelWorkout(this.activeWorkoutLog.id);
      this.applyTodayState({ activeLog: null, completedToday: null });
    } catch (error) {
      this.errorMessage = toErrorMessage(error, 'Antrenamentul nu a putut fi anulat.');
    } finally {
      this.isUpdatingActiveLog = false;
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

  get checkinModalTitle(): string {
    if (this.checkinMode === 'already_done') {
      return 'Ce antrenament ai făcut azi?';
    }
    if (this.checkinMode === 'started_now') {
      return 'Ce antrenament o să lucrezi?';
    }
    return 'Antrenamentul de azi';
  }

  private async loadHomeData(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) {
      await this.router.navigateByUrl('/auth', { replaceUrl: true });
      return;
    }

    this.isLoading = true;
    this.isCheckingToday = true;
    this.errorMessage = null;
    try {
      const [routines, profile, todayState] = await Promise.all([
        this.routinesService.listForUser(user.id),
        this.profileService.getCurrentProfile(user.id),
        this.dailyWorkoutService.getTodayState(user.id),
      ]);
      this.routines = routines;
      this.profile = profile;
      this.applyTodayState(todayState);
    } catch (error) {
      this.errorMessage = toErrorMessage(error, 'Rutinele nu au putut fi încărcate.');
    } finally {
      this.isLoading = false;
      this.isCheckingToday = false;
      this.changeDetector.detectChanges();
    }
  }

  private async refreshHomeData(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) {
      return;
    }

    try {
      const [routines, profile, todayState] = await Promise.all([
        this.routinesService.listForUser(user.id),
        this.profileService.getCurrentProfile(user.id),
        this.dailyWorkoutService.getTodayState(user.id),
      ]);
      this.routines = routines;
      this.profile = profile;
      this.applyTodayState(todayState);
    } catch (error) {
      this.errorMessage = toErrorMessage(error, 'Datele nu au putut fi reîmprospătate.');
    } finally {
      this.isCheckingToday = false;
      this.changeDetector.detectChanges();
    }
  }

  private applyTodayState(state: TodayWorkoutState): void {
    this.activeWorkoutLog = state.activeLog;
    this.completedTodayLog = state.completedToday;
    if (state.activeLog?.capture_at) {
      this.startCountdown(state.activeLog.capture_at);
    } else {
      this.stopCountdown();
    }
  }

  private startCountdown(captureAtIso: string): void {
    this.stopCountdown();
    const captureAtMs = new Date(captureAtIso).getTime();
    const tick = (): void => {
      const remainingMs = captureAtMs - Date.now();
      this.remainingTimeLabel = formatCountdown(remainingMs);
      if (remainingMs <= 0) {
        this.stopCountdown();
        void this.autoFinalizeDueWorkout();
      }
      this.changeDetector.detectChanges();
    };

    tick();
    if (captureAtMs - Date.now() > 0) {
      this.countdownIntervalId = setInterval(tick, 1000);
    }
  }

  private stopCountdown(): void {
    if (this.countdownIntervalId !== null) {
      clearInterval(this.countdownIntervalId);
      this.countdownIntervalId = null;
    }
  }

  private async autoFinalizeDueWorkout(): Promise<void> {
    if (this.isAutoFinalizing || !this.isViewActive) {
      return;
    }
    const user = this.auth.currentUser();
    if (!user) {
      return;
    }

    this.isAutoFinalizing = true;
    try {
      const state = await this.dailyWorkoutService.getTodayState(user.id);
      this.applyTodayState(state);
    } catch (error) {
      this.errorMessage = toErrorMessage(error, 'Antrenamentul nu a putut fi finalizat automat.');
    } finally {
      this.isAutoFinalizing = false;
      this.changeDetector.detectChanges();
    }
  }

  private attachVisibilityListener(): void {
    if (typeof document !== 'undefined' && !this.visibilityListenerAttached) {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
      this.visibilityListenerAttached = true;
    }
  }

  private detachVisibilityListener(): void {
    if (typeof document !== 'undefined' && this.visibilityListenerAttached) {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
      this.visibilityListenerAttached = false;
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
