import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonButton,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonNote,
  IonRadio,
  IonRadioGroup,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';

import { AuthService } from '../../core/auth/auth.service';
import { ProfileService, type FitnessGoal, type ExperienceLevel } from '../../core/profile/profile.service';

@Component({
  selector: 'app-onboarding',
  templateUrl: './onboarding.page.html',
  styleUrl: './onboarding.page.scss',
  imports: [
    FormsModule,
    IonButton,
    IonContent,
    IonHeader,
    IonItem,
    IonLabel,
    IonNote,
    IonRadio,
    IonRadioGroup,
    IonSelect,
    IonSelectOption,
    IonTitle,
    IonToolbar,
  ],
})
export class OnboardingPage {
  private readonly auth = inject(AuthService);
  private readonly profile = inject(ProfileService);
  private readonly router = inject(Router);

  weeklyGoal = 3;
  fitnessGoal: FitnessGoal = 'hypertrophy';
  experienceLevel: ExperienceLevel = 'beginner';
  isSubmitting = false;
  errorMessage: string | null = null;

  async submit(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) {
      await this.router.navigateByUrl('/auth', { replaceUrl: true });
      return;
    }

    this.errorMessage = null;
    this.isSubmitting = true;

    try {
      await this.profile.completeOnboarding(user.id, {
        weeklyGoal: this.weeklyGoal,
        fitnessGoal: this.fitnessGoal,
        experienceLevel: this.experienceLevel,
      });
      await this.router.navigateByUrl('/home', { replaceUrl: true });
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Onboarding-ul nu a putut fi salvat.';
    } finally {
      this.isSubmitting = false;
    }
  }
}
