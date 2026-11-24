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
  IonItem,
  IonLabel,
  IonNote,
  IonModal,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import type { ChartConfiguration, ChartOptions } from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';

import { AuthService } from '../../core/auth/auth.service';
import {
  buildExerciseChoicesFromEvents,
  buildMonthlyVolumeData,
  buildMuscleDistributionData,
  buildRelativeStrengthData,
  buildStrengthChartData,
  buildWeeklyVolumeData,
  emptyBarData,
  emptyDoughnutData,
  emptyLineData,
  type ExerciseChoice,
  type ForceMetric,
  type GraphSet,
  type StrengthEventPoint,
} from '../../core/graphs/graphs-calculations';
import { GraphsService } from '../../core/graphs/graphs.service';
import { ProfileService, type Profile } from '../../core/profile/profile.service';
import type { DailyWorkoutLog } from '../../core/workouts/daily-workout.service';
import { TabsPage } from '../tabs/tabs.page';

type ChartInfoKey = 'weekly' | 'monthly' | 'strength' | 'muscles' | 'relative';

@Component({
  selector: 'app-graphs',
  templateUrl: './graphs.page.html',
  styleUrl: './graphs.page.scss',
  imports: [
    BaseChartDirective,
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
    IonItem,
    IonLabel,
    IonNote,
    IonModal,
    IonSegment,
    IonSegmentButton,
    IonSelect,
    IonSelectOption,
    IonTitle,
    IonToolbar,
    TabsPage,
  ],
})
export class GraphsPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly graphsService = inject(GraphsService);
  private readonly profileService = inject(ProfileService);
  private readonly router = inject(Router);

  completedLogs: DailyWorkoutLog[] = [];
  currentSets: GraphSet[] = [];
  strengthEvents: StrengthEventPoint[] = [];
  profile: Profile | null = null;
  exercises: ExerciseChoice[] = [];
  selectedExerciseId: string | null = null;
  forceMetric: ForceMetric = 'weight';
  isLoading = true;
  errorMessage: string | null = null;
  infoKey: ChartInfoKey | null = null;

  weeklyData: ChartConfiguration<'bar'>['data'] = emptyBarData();
  monthlyData: ChartConfiguration<'bar'>['data'] = emptyBarData();
  strengthData: ChartConfiguration<'line'>['data'] = emptyLineData();
  muscleData: ChartConfiguration<'doughnut'>['data'] = emptyDoughnutData();
  relativeData: ChartConfiguration<'bar'>['data'] = emptyBarData();

  readonly barOptions: ChartOptions<'bar'> = barChartOptions();
  readonly lineOptions: ChartOptions<'line'> = lineChartOptions();
  readonly relativeOptions: ChartOptions<'bar'> = relativeChartOptions();
  readonly doughnutOptions: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#F8FAFC' } },
      tooltip: {
        callbacks: {
          label: (context) => `${context.label}: ${Number(context.parsed).toLocaleString('ro-RO')} kg`,
        },
      },
    },
  };

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async ionViewWillEnter(): Promise<void> {
    await this.load();
  }

  get hasWeeklyData(): boolean {
    return this.weeklyData.datasets[0]?.data.length > 0;
  }

  get hasMonthlyData(): boolean {
    return this.monthlyData.datasets[0]?.data.length > 0;
  }

  get hasStrengthData(): boolean {
    return this.strengthData.datasets[0]?.data.length > 0;
  }

  get hasMuscleData(): boolean {
    return this.muscleData.datasets[0]?.data.length > 0;
  }

  get hasRelativeData(): boolean {
    return this.relativeData.datasets[0]?.data.length > 0;
  }

  get profileAnalysisAvailable(): boolean {
    return Boolean(
      this.profile?.weight_kg && this.profile?.height_cm && this.profile?.age && this.profile.avatar_style,
    );
  }

  get infoTitle(): string {
    return {
      weekly: 'Volum săptămânal',
      monthly: 'Volum lunar',
      strength: 'Evoluția forței',
      muscles: 'Distribuția volumului pe grupe musculare',
      relative: 'Forță relativă & nivel atletic',
    }[this.infoKey ?? 'weekly'];
  }

  get infoDescription(): string {
    return {
      weekly:
        'Însumează volumul tuturor antrenamentelor confirmate în fiecare săptămână calendaristică (luni–duminică). Pentru fiecare antrenament confirmat se salvează snapshot-ul seriilor active la finalul sesiunii (greutate × repetări), astfel încât săptămânile trecute rămân înghețate.',
      monthly:
        'Însumează volumul antrenamentelor confirmate în fiecare lună din ultimele 6 luni disponibile, folosind snapshot-ul seriilor salvat pentru fiecare zi de sală.',
      strength:
        'Pentru exercițiul selectat folosește istoricul real al modificărilor de serii și păstrează cea mai mare valoare din fiecare zi. Poți vedea greutatea maximă sau 1RM estimat, calculat cu formula Epley: greutate × (1 + repetări / 30).',
      muscles:
        'Însumează volumul ultimelor serii active salvate în prezent pentru fiecare grupă musculară (greutate × repetări, exact valorile din interfață pentru exercițiile tale active, fără dublarea exercițiilor comune mai multor antrenamente).',
      relative:
        'Calculează 1RM-ul estimat pentru fiecare exercițiu și îl împarte la greutatea corporală din Profil. BMI-ul folosește greutate / înălțime², iar TDEE folosește formula Mifflin–St Jeor și nivelul săptămânal de activitate.',
    }[this.infoKey ?? 'weekly'];
  }

  get bmi(): number | null {
    if (!this.profile?.weight_kg || !this.profile.height_cm) {
      return null;
    }
    const heightMeters = this.profile.height_cm / 100;
    return this.profile.weight_kg / (heightMeters * heightMeters);
  }

  get tdee(): number | null {
    if (!this.profile?.weight_kg || !this.profile.height_cm || !this.profile.age || !this.profile.avatar_style) {
      return null;
    }
    const base =
      10 * this.profile.weight_kg +
      6.25 * this.profile.height_cm -
      5 * this.profile.age +
      (this.profile.avatar_style === 'male' ? 5 : -161);
    return Math.round(base * activityFactor(this.profile.weekly_goal));
  }

  onExerciseChanged(): void {
    this.updateStrengthChart();
  }

  onMetricChanged(): void {
    this.updateStrengthChart();
  }

  openInfo(key: ChartInfoKey): void {
    this.infoKey = key;
  }

  closeInfo(): void {
    this.infoKey = null;
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
      const [graphsData, profile] = await Promise.all([
        this.graphsService.loadGraphsData(user.id),
        this.profileService.getCurrentProfile(user.id),
      ]);
      this.completedLogs = graphsData.completedLogs;
      this.currentSets = graphsData.currentSets;
      this.strengthEvents = graphsData.strengthEvents;
      this.profile = profile;
      this.exercises = buildExerciseChoicesFromEvents(this.strengthEvents);
      if (!this.exercises.some((exercise) => exercise.id === this.selectedExerciseId)) {
        this.selectedExerciseId = this.exercises[0]?.id ?? null;
      }
      this.updateAllCharts();
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Graficele nu au putut fi încărcate.';
    } finally {
      this.isLoading = false;
      this.changeDetector.detectChanges();
    }
  }

  private updateAllCharts(): void {
    this.weeklyData = buildWeeklyVolumeData(this.completedLogs);
    this.monthlyData = buildMonthlyVolumeData(this.completedLogs);
    this.updateStrengthChart();
    this.muscleData = buildMuscleDistributionData(this.currentSets);
    this.relativeData = buildRelativeStrengthData(this.currentSets, this.profile);
  }

  openProfile(): void {
    void this.router.navigateByUrl('/profile');
  }

  private updateStrengthChart(): void {
    this.strengthData = buildStrengthChartData(this.strengthEvents, this.selectedExerciseId, this.forceMetric);
  }
}

function barChartOptions(): ChartOptions<'bar'> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { ticks: { color: '#94A3B8', maxTicksLimit: 6 }, grid: { color: 'rgba(255, 255, 255, 0.05)' } },
      y: { ticks: { color: '#94A3B8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' }, beginAtZero: true },
    },
    plugins: {
      legend: { labels: { color: '#F8FAFC' } },
      tooltip: { callbacks: { label: (context) => `${Number(context.parsed.y).toLocaleString('ro-RO')} kg` } },
    },
  };
}

function lineChartOptions(): ChartOptions<'line'> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { ticks: { color: '#94A3B8', maxTicksLimit: 6 }, grid: { color: 'rgba(255, 255, 255, 0.05)' } },
      y: { ticks: { color: '#94A3B8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' }, beginAtZero: true },
    },
    plugins: {
      legend: { labels: { color: '#F8FAFC' } },
      tooltip: { callbacks: { label: (context) => `${Number(context.parsed.y).toLocaleString('ro-RO')} kg` } },
    },
  };
}

function relativeChartOptions(): ChartOptions<'bar'> {
  return {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        beginAtZero: true,
        ticks: { color: '#94A3B8', callback: (value) => `${value}x` },
        grid: { color: 'rgba(255, 255, 255, 0.05)' },
      },
      y: { ticks: { color: '#94A3B8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } },
    },
    plugins: {
      legend: { labels: { color: '#F8FAFC' } },
      tooltip: {
        callbacks: { label: (context) => `${Number(context.parsed.x).toFixed(2)}x BW` },
      },
    },
  };
}

function activityFactor(weeklyGoal: number): number {
  if (weeklyGoal <= 1) return 1.2;
  if (weeklyGoal <= 3) return 1.375;
  if (weeklyGoal <= 5) return 1.55;
  return 1.725;
}
