import { Component, inject } from '@angular/core';
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
export class AuthPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly runtimeConfig = inject(RuntimeConfigService);

  email = '';
  password = '';
  isSignUp = false;
  isSubmitting = false;
  errorMessage: string | null = null;
  infoMessage: string | null = null;

  get isSupabaseConfigured(): boolean {
    return this.runtimeConfig.isSupabaseConfigured;
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
      } else {
        await this.auth.signIn(this.email, this.password);
      }

      await this.router.navigateByUrl('/home', { replaceUrl: true });
    } catch (error) {
      this.errorMessage = toErrorMessage(error);
    } finally {
      this.isSubmitting = false;
    }
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
