import { ChangeDetectorRef, Component, inject } from '@angular/core';
import type { OnInit } from '@angular/core';
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
  IonNote,
  IonProgressBar,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';

import { AchievementService, type Achievement } from '../../core/achievements/achievement.service';
import { AuthService } from '../../core/auth/auth.service';
import { TabsPage } from '../tabs/tabs.page';

@Component({
  selector: 'app-achievements',
  templateUrl: './achievements.page.html',
  styleUrl: './achievements.page.scss',
  imports: [
    IonBackButton,
    IonButtons,
    IonCard,
    IonCardContent,
    IonCardHeader,
    IonCardTitle,
    IonContent,
    IonHeader,
    IonNote,
    IonProgressBar,
    IonTitle,
    IonToolbar,
    TabsPage,
  ],
})
export class AchievementsPage implements OnInit {
  private readonly achievementsService = inject(AchievementService);
  private readonly auth = inject(AuthService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly router = inject(Router);

  achievements: Achievement[] = [];
  isLoading = true;
  errorMessage: string | null = null;

  async ngOnInit(): Promise<void> {
    await this.loadAchievements();
  }

  async ionViewWillEnter(): Promise<void> {
    if (!this.isLoading) {
      await this.loadAchievements();
    }
  }

  private async loadAchievements(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) {
      await this.router.navigateByUrl('/auth', { replaceUrl: true });
      return;
    }

    try {
      this.achievements = await this.achievementsService.listForUser(user.id);
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Achievements nu au putut fi încărcate.';
    } finally {
      this.isLoading = false;
      this.changeDetector.detectChanges();
    }
  }

  progressValue(achievement: Achievement): number {
    return achievement.target > 0 ? achievement.progress / achievement.target : 0;
  }

  get unlockedCount(): number {
    return this.achievements.filter((achievement) => achievement.unlockedAt !== null).length;
  }
}
