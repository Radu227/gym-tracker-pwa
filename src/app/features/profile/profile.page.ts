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
  IonLabel,
  IonNote,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';

import { AuthService } from '../../core/auth/auth.service';
import { NotificationService } from '../../core/notifications/notification.service';
import { ProfileService, type AvatarStyle, type Profile } from '../../core/profile/profile.service';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.page.html',
  styleUrl: './profile.page.scss',
  imports: [
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
    IonLabel,
    IonNote,
    IonSelect,
    IonSelectOption,
    IonTitle,
    IonToolbar,
  ],
})
export class ProfilePage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly profileService = inject(ProfileService);
  private readonly router = inject(Router);
  readonly notifications = inject(NotificationService);

  profile: Profile | null = null;
  firstName = '';
  lastName = '';
  avatarStyle: AvatarStyle = 'male';
  age: number | null = null;
  weightKg: number | null = null;
  heightCm: number | null = null;
  currentPassword = '';
  newPassword = '';
  isLoading = true;
  isSaving = false;
  isChangingPassword = false;
  message: string | null = null;
  errorMessage: string | null = null;

  get email(): string {
    return this.auth.currentUser()?.email ?? '';
  }

  async ngOnInit(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) {
      await this.router.navigateByUrl('/auth', { replaceUrl: true });
      return;
    }

    try {
      this.profile = await this.profileService.getCurrentProfile(user.id);
      this.firstName = this.profile.first_name ?? '';
      this.lastName = this.profile.last_name ?? '';
      this.avatarStyle = this.profile.avatar_style ?? 'male';
      this.age = this.profile.age;
      this.weightKg = this.profile.weight_kg;
      this.heightCm = this.profile.height_cm;
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Profilul nu a putut fi încărcat.';
    } finally {
      this.isLoading = false;
      this.changeDetector.detectChanges();
    }
  }

  async saveProfile(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user) {
      return;
    }

    this.isSaving = true;
    this.message = null;
    this.errorMessage = null;
    try {
      this.profile = await this.profileService.updateDetails(user.id, {
        firstName: this.firstName,
        lastName: this.lastName,
        avatarStyle: this.avatarStyle,
        age: this.age,
        weightKg: this.weightKg,
        heightCm: this.heightCm,
      });
      this.message = 'Profil salvat.';
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Profilul nu a putut fi salvat.';
    } finally {
      this.isSaving = false;
      this.changeDetector.detectChanges();
    }
  }

  async changePassword(): Promise<void> {
    this.isChangingPassword = true;
    this.message = null;
    this.errorMessage = null;
    try {
      await this.auth.changePassword(this.currentPassword, this.newPassword);
      this.currentPassword = '';
      this.newPassword = '';
      this.message = 'Parola a fost schimbată.';
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Parola nu a putut fi schimbată.';
    } finally {
      this.isChangingPassword = false;
      this.changeDetector.detectChanges();
    }
  }

  async enableNotifications(): Promise<void> {
    this.message = null;
    this.errorMessage = null;
    try {
      await this.notifications.enable();
      this.message = 'Notificările de inactivitate sunt active.';
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Notificările nu au putut fi activate.';
    } finally {
      this.changeDetector.detectChanges();
    }
  }

  async disableNotifications(): Promise<void> {
    this.message = null;
    this.errorMessage = null;
    try {
      await this.notifications.disable();
      this.message = 'Notificările au fost dezactivate.';
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Notificările nu au putut fi dezactivate.';
    } finally {
      this.changeDetector.detectChanges();
    }
  }
}
