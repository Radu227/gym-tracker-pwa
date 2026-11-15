import { DecimalPipe } from '@angular/common';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import type { OnInit } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonContent,
  IonHeader,
  IonIcon,
  IonNote,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chevronBack, chevronForward } from 'ionicons/icons';

import { AuthService } from '../../core/auth/auth.service';
import { ProgressService, toDateKey, type ProgressStatistics } from '../../core/progress/progress.service';
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
    IonBackButton,
    IonButton,
    IonButtons,
    IonCard,
    IonCardContent,
    IonContent,
    IonHeader,
    IonIcon,
    IonNote,
    IonTitle,
    IonToolbar,
    TabsPage,
  ],
})
export class ProgressPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly progressService = inject(ProgressService);
  private readonly router = inject(Router);

  displayedMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  calendarDays: CalendarDay[] = [];
  isLoading = true;
  errorMessage: string | null = null;
  statistics: ProgressStatistics | null = null;

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

  previousMonth(): void {
    this.displayedMonth = new Date(this.displayedMonth.getFullYear(), this.displayedMonth.getMonth() - 1, 1);
    void this.loadMonth();
  }

  nextMonth(): void {
    this.displayedMonth = new Date(this.displayedMonth.getFullYear(), this.displayedMonth.getMonth() + 1, 1);
    void this.loadMonth();
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
      const [workoutDates, statistics] = await Promise.all([
        this.progressService.listWorkoutDates(user.id, this.displayedMonth),
        this.progressService.getStatistics(user.id),
      ]);
      this.calendarDays = createCalendarDays(this.displayedMonth, workoutDates);
      this.statistics = statistics;
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Calendarul nu a putut fi încărcat.';
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
