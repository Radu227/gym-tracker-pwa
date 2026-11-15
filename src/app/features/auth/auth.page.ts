import { Component, DestroyRef, inject } from '@angular/core';
import type { OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonButton, IonContent, IonHeader, IonInput, IonItem, IonNote, IonTitle, IonToolbar } from '@ionic/angular';

import { AuthService } from '../../core/auth/auth.service';
import { RuntimeConfigService } from '../../core/supabase/runtime-config.service';

@Component({
  selector: 'app-auth',
  templateUrl: './auth.page.html',
  styleUrl: './auth.page.scss',
  imports: [FormsModule, IonButton, IonContent, IonHeader, IonInput, IonItem, IonNote, IonTitle, IonToolbar],
})
export class AuthPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly runtimeConfig = inject(RuntimeConfigService);

  email = '';
  password = '';
  newPassword = '';
  confirmPassword = '';
  isSignUp = false;
  isForgotPassword = false;
  isRecoveryMode = false;
  isSubmitting = false;
  errorMessage: string | null = null;
  infoMessage: string | null = null;

  get isSupabaseConfigured(): boolean {
    return this.runtimeConfig.isSupabaseConfigured;
  }

  ngOnInit(): void {
    this.auth.isPasswordRecovery$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((isRecovery) => {
      this.isRecoveryMode = isRecovery;
      if (isRecovery) {
        this.isForgotPassword = false;
      }
    });
  }

  async submit(): Promise<void> {
    this.errorMessage = null;
    this.infoMessage = null;

    if (!this.email.trim() || !this.password) {
      this.errorMessage = 'Completează emailul și parola.';
      return;
    }

    this.isSubmitting = true;
    try {
      if (this.isSignUp) {
        const { session } = await this.auth.signUp(this.email, this.password);
        if (!session) {
          this.infoMessage = 'Verifică adresa de email pentru a confirma contul.';
          return;
        }
        await this.router.navigateByUrl('/onboarding', { replaceUrl: true });
        return;
      }

      await this.auth.signIn(this.email, this.password);
      await this.router.navigateByUrl('/home', { replaceUrl: true });
    } catch (error) {
      this.errorMessage = toErrorMessage(error);
    } finally {
      this.isSubmitting = false;
    }
  }

  async requestPasswordReset(): Promise<void> {
    this.errorMessage = null;
    this.infoMessage = null;

    if (!this.email.trim()) {
      this.errorMessage = 'Completează emailul pentru a primi linkul de resetare.';
      return;
    }

    this.isSubmitting = true;
    try {
      await this.auth.requestPasswordReset(this.email);
      this.infoMessage = 'Ți-am trimis un email cu linkul de resetare a parolei. Verifică și folderul Spam.';
    } catch (error) {
      this.errorMessage = toErrorMessage(error);
    } finally {
      this.isSubmitting = false;
    }
  }

  async saveNewPassword(): Promise<void> {
    this.errorMessage = null;
    this.infoMessage = null;

    if (this.newPassword.length < 6) {
      this.errorMessage = 'Parola nouă trebuie să aibă cel puțin 6 caractere.';
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.errorMessage = 'Parolele nu coincid.';
      return;
    }

    this.isSubmitting = true;
    try {
      await this.auth.updatePassword(this.newPassword);
      this.infoMessage = 'Parola a fost schimbată cu succes. Te redirecționăm…';
      await new Promise((resolve) => setTimeout(resolve, 1200));
      this.auth.clearPasswordRecovery();
      await this.router.navigateByUrl('/home', { replaceUrl: true });
    } catch (error) {
      this.errorMessage = toErrorMessage(error);
    } finally {
      this.isSubmitting = false;
    }
  }

  startPasswordReset(): void {
    this.isForgotPassword = true;
    this.errorMessage = null;
    this.infoMessage = null;
  }

  cancelPasswordReset(): void {
    this.isForgotPassword = false;
    this.errorMessage = null;
    this.infoMessage = null;
  }

  toggleMode(): void {
    this.isSignUp = !this.isSignUp;
    this.errorMessage = null;
    this.infoMessage = null;
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Autentificarea nu a reușit. Încearcă din nou.';
}
