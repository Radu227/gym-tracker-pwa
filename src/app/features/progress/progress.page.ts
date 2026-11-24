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
  IonIcon,
  IonInput,
  IonItem,
  IonModal,
  IonNote,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chevronBack, chevronForward } from 'ionicons/icons';

import { AuthService } from '../../core/auth/auth.service';
import { ProgressService, toDateKey, type ProgressStatistics } from '../../core/progress/progress.service';
import { RoutineService, type Routine } from '../../core/routines/routine.service';
import { DailyWorkoutService } from '../../core/workouts/daily-workout.service';
import { TabsPage } from '../tabs/tabs.page';

interface CalendarDay {
  key: string;
  day: number;
  isToday: boolean;
  isCurrentMonth: boolean;
  hasWorkout: boolean;
}

@Component({
  selector: 'app-progress',
  templateUrl: './progress.page.html',
  styleUrl: './progress.page.scss',
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
    IonIcon,
    IonInput,
    IonItem,
    IonModal,
    IonNote,
    IonTitle,
    IonToolbar,
    TabsPage,
  ],
})
export class ProgressPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly dailyWorkoutService = inject(DailyWorkoutService);
  private readonly progressService = inject(ProgressService);
  private readonly routineService = inject(RoutineService);
  private readonly router = inject(Router);

  displayedMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  calendarDays: CalendarDay[] = [];
  isLoading = true;
  errorMessage: string | null = null;
  statistics: ProgressStatistics | null = null;
  routines: Routine[] = [];

  isMissedModalOpen = false;
  missedDate = '';
  selectedRoutineId: string | null = null;
  isSavingMissed = false;
  missedErrorMessage: string | null = null;
  missedSuccessMessage: string | null = null;

  constructor() {
    addIcons({ chevronBack, chevronForward });
  }

  async ngOnInit(): Promise<void> {
    await this.loadMonth();
  }

  async ionViewWillEnter(): Promise<void> {
    await this.loadMonth();
  }

  get monthLabel(): string {
    return new Intl.DateTimeFormat('ro-RO', { month: 'long', year: 'numeric' }).format(this.displayedMonth);
  }

  get maxMissedDate(): string {
    const today = new Date();
    return toDateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));
  }

  previousMonth(): void {
    this.displayedMonth = new Date(this.displayedMonth.getFullYear(), this.displayedMonth.getMonth() - 1, 1);
    void this.loadMonth();
  }

  nextMonth(): void {
    this.displayedMonth = new Date(this.displayedMonth.getFullYear(), this.displayedMonth.getMonth() + 1, 1);
    void this.loadMonth();
  }

  openMissedWorkoutModal(): void {
    this.missedErrorMessage = null;
    this.missedDate = this.maxMissedDate;
    this.selectedRoutineId = this.routines[0]?.id ?? null;
    this.isMissedModalOpen = true;
  }

  closeMissedWorkoutModal(): void {
    if (this.isSavingMissed) {
      return;
    }
    this.isMissedModalOpen = false;
    this.missedErrorMessage = null;
  }

  selectMissedRoutine(routineId: string): void {
    this.selectedRoutineId = routineId;
    this.missedErrorMessage = null;
  }

  async saveMissedWorkout(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) {
      await this.router.navigateByUrl('/auth', { replaceUrl: true });
      return;
    }
    if (!this.missedDate || !this.selectedRoutineId || this.isSavingMissed) {
      return;
    }
    if (this.missedDate > this.maxMissedDate) {
      this.missedErrorMessage = 'Selectează o zi anterioară zilei de azi.';
      return;
    }

    this.isSavingMissed = true;
    this.missedErrorMessage = null;
    this.missedSuccessMessage = null;
    try {
      const saved = await this.dailyWorkoutService.logPastWorkout(this.selectedRoutineId, this.missedDate);
      this.isMissedModalOpen = false;
      const parsed = parseLocalDate(saved.workout_date);
      if (parsed) {
        this.displayedMonth = new Date(parsed.getFullYear(), parsed.getMonth(), 1);
      }
      await this.loadMonth();
      const volumeLabel = Math.round(saved.total_volume_kg).toLocaleString('ro-RO');
      this.missedSuccessMessage = `Antrenamentul „${saved.routine_name_snapshot}” din ${formatDisplayDate(saved.workout_date)} a fost salvat (${volumeLabel} kg).`;
    } catch (error) {
      this.missedErrorMessage = toErrorMessage(error, 'Antrenamentul nu a putut fi înregistrat.');
    } finally {
      this.isSavingMissed = false;
      this.changeDetector.detectChanges();
    }
  }

  private async loadMonth(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) {
      await this.router.navigateByUrl('/auth', { replaceUrl: true });
      return;
    }

    this.isLoading = true;
    this.errorMessage = null;
    try {
      await this.dailyWorkoutService.finalizeDueWorkouts().catch(() => undefined);
      const [workoutDates, statistics, routines] = await Promise.all([
        this.progressService.listWorkoutDates(user.id, this.displayedMonth),
        this.progressService.getStatistics(user.id),
        this.routineService.listForUser(user.id),
      ]);
      this.calendarDays = createCalendarDays(this.displayedMonth, workoutDates);
      this.statistics = statistics;
      this.routines = routines;
    } catch (error) {
      this.errorMessage = toErrorMessage(error, 'Calendarul nu a putut fi încărcat.');
    } finally {
      this.isLoading = false;
      this.changeDetector.detectChanges();
    }
  }
}

function createCalendarDays(month: Date, workoutDates: Set<string>): CalendarDay[] {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const totalCells = Math.ceil((mondayOffset + daysInMonth) / 7) * 7;
  const todayKey = toDateKey(new Date());
  const days: CalendarDay[] = [];

  for (let index = 0; index < totalCells; index += 1) {
    const dayNumber = index - mondayOffset + 1;
    const date = new Date(month.getFullYear(), month.getMonth(), dayNumber);
    const isCurrentMonth = dayNumber >= 1 && dayNumber <= daysInMonth;
    const key = toDateKey(date);
    days.push({
      key,
      day: date.getDate(),
      isToday: key === todayKey,
      isCurrentMonth,
      hasWorkout: isCurrentMonth && workoutDates.has(key),
    });
  }

  return days;
}

function parseLocalDate(value: string): Date | null {
  const parts = value.slice(0, 10).split('-').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) {
    return null;
  }
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function formatDisplayDate(value: string): string {
  const parsed = parseLocalDate(value);
  if (!parsed) {
    return value;
  }
  return new Intl.DateTimeFormat('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(parsed);
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
