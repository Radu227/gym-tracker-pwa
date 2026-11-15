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
import { GraphsService, type GraphSet } from '../../core/graphs/graphs.service';
import { ProfileService, type Profile } from '../../core/profile/profile.service';
import { TabsPage } from '../tabs/tabs.page';

type ForceMetric = 'weight' | 'oneRm';
type ChartInfoKey = 'weekly' | 'monthly' | 'strength' | 'muscles' | 'relative';

interface ExerciseChoice {
  id: string;
  name: string;
  count: number;
}

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

  sets: GraphSet[] = [];
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
        'Însumează volumul tuturor seriilor curente din fiecare săptămână calendaristică, de luni până duminică. Formula este greutate × repetări, iar graficul afișează ultimele 8 săptămâni.',
      monthly:
        'Însumează volumul tuturor seriilor curente din fiecare lună. Formula este greutate × repetări, iar graficul afișează ultimele 6 luni disponibile.',
      strength:
        'Pentru exercițiul selectat păstrează cea mai mare valoare din fiecare zi. Poți vedea greutatea maximă sau 1RM estimat, calculat cu formula Epley: greutate × (1 + repetări / 30).',
      muscles:
        'Grupează toate seriile curente salvate după grupa musculară asociată exercițiului și însumează volumul. Nu aplică limită de timp; modificările seriilor înlocuiesc valoarea curentă, fără să șteargă istoricul.',
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
      [this.sets, this.profile] = await Promise.all([
        this.graphsService.listSets(user.id),
        this.profileService.getCurrentProfile(user.id),
      ]);
      this.exercises = buildExerciseChoices(this.sets);
      this.selectedExerciseId ??= this.exercises[0]?.id ?? null;
      this.updateAllCharts();
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Graficele nu au putut fi încărcate.';
    } finally {
      this.isLoading = false;
      this.changeDetector.detectChanges();
    }
  }

  private updateAllCharts(): void {
    this.weeklyData = buildVolumeData(this.sets, 'week');
    this.monthlyData = buildVolumeData(this.sets, 'month');
    this.updateStrengthChart();
    this.muscleData = buildMuscleData(this.sets);
    this.relativeData = buildRelativeData(this.sets, this.profile);
  }

  openProfile(): void {
    void this.router.navigateByUrl('/profile');
  }

  private updateStrengthChart(): void {
    const selectedSets = this.sets
      .filter((set) => set.exerciseId === this.selectedExerciseId)
      .sort((left, right) => left.performedAt.localeCompare(right.performedAt));
    const byDay = new Map<string, number>();
    for (const set of selectedSets) {
      const key = new Date(set.performedAt).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit' });
      const value = this.forceMetric === 'weight' ? set.weightKg : set.weightKg * (1 + set.reps / 30);
      byDay.set(key, Math.max(byDay.get(key) ?? 0, value));
    }
    this.strengthData = {
      labels: [...byDay.keys()],
      datasets: [
        {
          data: [...byDay.values()],
          label: this.forceMetric === 'weight' ? 'Greutate maximă (kg)' : '1RM estimat (kg)',
          borderColor: '#F59E0B',
          backgroundColor: 'rgba(245, 158, 11, 0.18)',
          tension: 0.3,
          fill: true,
        },
      ],
    };
  }
}

function buildExerciseChoices(sets: GraphSet[]): ExerciseChoice[] {
  const counts = new Map<string, ExerciseChoice>();
  for (const set of sets) {
    const current = counts.get(set.exerciseId);
    counts.set(set.exerciseId, {
      id: set.exerciseId,
      name: set.exerciseName,
      count: (current?.count ?? 0) + 1,
    });
  }
  return [...counts.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

function buildVolumeData(sets: GraphSet[], grouping: 'week' | 'month'): ChartConfiguration<'bar'>['data'] {
  const now = new Date();
  const values = new Map<string, number>();
  for (let index = grouping === 'week' ? 7 : 5; index >= 0; index -= 1) {
    const date = new Date(now);
    if (grouping === 'week') {
      date.setDate(now.getDate() - index * 7);
      date.setHours(0, 0, 0, 0);
      const monday = new Date(date);
      monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
      values.set(toKey(monday), 0);
    } else {
      date.setDate(1);
      date.setMonth(now.getMonth() - index);
      values.set(toKey(date).slice(0, 7), 0);
    }
  }

  for (const set of sets) {
    const date = new Date(set.performedAt);
    const key =
      grouping === 'week'
        ? toKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7)))
        : toKey(date).slice(0, 7);
    if (values.has(key)) {
      values.set(key, (values.get(key) ?? 0) + set.weightKg * set.reps);
    }
  }

  return {
    labels: [...values.keys()].map((key) => (grouping === 'week' ? formatWeekLabel(key) : formatMonthLabel(key))),
    datasets: [
      {
        data: [...values.values()],
        label: grouping === 'week' ? 'Volum săptămânal (kg)' : 'Volum lunar (kg)',
        backgroundColor: '#F59E0B',
        borderRadius: 6,
      },
    ],
  };
}

function buildMuscleData(sets: GraphSet[]): ChartConfiguration<'doughnut'>['data'] {
  const totals = new Map<string, number>();
  for (const set of sets) {
    const group = set.muscleGroup.trim() || 'Nespecificat';
    totals.set(group, (totals.get(group) ?? 0) + set.weightKg * set.reps);
  }
  return {
    labels: [...totals.keys()],
    datasets: [
      {
        data: [...totals.values()],
        backgroundColor: [...totals.keys()].map((_, index) => muscleColor(index)),
        borderColor: '#14161C',
        borderWidth: 2,
      },
    ],
  };
}

function buildRelativeData(sets: GraphSet[], profile: Profile | null): ChartConfiguration<'bar'>['data'] {
  if (!profile?.weight_kg || !profile.height_cm || !profile.age || !profile.avatar_style) {
    return emptyBarData();
  }

  const topExercises = new Map<string, { name: string; oneRm: number }>();
  for (const set of sets) {
    const oneRm = set.weightKg * (1 + set.reps / 30);
    const current = topExercises.get(set.exerciseId);
    if (!current || oneRm > current.oneRm) {
      topExercises.set(set.exerciseId, { name: set.exerciseName, oneRm });
    }
  }
  const rows = [...topExercises.values()].sort((left, right) => right.oneRm - left.oneRm).slice(0, 6);
  return {
    labels: rows.map((row) => row.name),
    datasets: [
      {
        data: rows.map((row) => Number((row.oneRm / profile.weight_kg!).toFixed(2))),
        label: 'Multiplu greutate corporală',
        backgroundColor: '#F59E0B',
        borderRadius: 6,
      },
    ],
  };
}

function emptyBarData(): ChartConfiguration<'bar'>['data'] {
  return { labels: [], datasets: [{ data: [] }] };
}

function emptyLineData(): ChartConfiguration<'line'>['data'] {
  return { labels: [], datasets: [{ data: [] }] };
}

function emptyDoughnutData(): ChartConfiguration<'doughnut'>['data'] {
  return { labels: [], datasets: [{ data: [] }] };
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

function muscleColor(index: number): string {
  return `hsl(${(index * 137.5) % 360} 75% 55%)`;
}

function toKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatWeekLabel(key: string): string {
  return new Date(`${key}T00:00:00`).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit' });
}

function formatMonthLabel(key: string): string {
  return new Date(`${key}-01T00:00:00`).toLocaleDateString('ro-RO', { month: 'short' });
}
