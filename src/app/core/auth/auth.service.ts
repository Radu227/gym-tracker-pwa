import { inject, Injectable, signal } from '@angular/core';
import type { SupabaseClient, User } from '@supabase/supabase-js';

import { SupabaseClientService } from '../supabase/supabase-client.service';

type SignUpData = Awaited<ReturnType<SupabaseClient['auth']['signUp']>>['data'];
type SignInData = Awaited<ReturnType<SupabaseClient['auth']['signInWithPassword']>>['data'];

@Injectable({ providedIn: 'root' })
export class AuthService {
  private static readonly requestTimeoutMs = 15_000;

  readonly currentUser = signal<User | null>(null);
  readonly isInitialized = signal(false);
  readonly isPasswordRecovery = signal(false);

  private readonly supabase = inject(SupabaseClientService);
  private readonly userChangeListeners = new Set<(user: User | null) => void>();
  private authSubscription: { unsubscribe: () => void } | null = null;

  async initialize(): Promise<void> {
    if (this.isInitialized()) {
      return;
    }

    if (!this.supabase.isConfigured) {
      this.isInitialized.set(true);
      return;
    }

    if (hasPasswordRecoveryUrl()) {
      this.isPasswordRecovery.set(true);
    }

    const {
      data: { subscription },
    } = this.supabase.client.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        this.isPasswordRecovery.set(true);
      }
      this.setCurrentUser(session?.user ?? null);
    });
    this.authSubscription = subscription;

    const {
      data: { session },
      error,
    } = await this.supabase.client.auth.getSession();
    if (error) {
      this.authSubscription.unsubscribe();
      this.authSubscription = null;
      throw error;
    }

    this.setCurrentUser(session?.user ?? null);
    this.isInitialized.set(true);
  }

  async signUp(email: string, password: string): Promise<SignUpData> {
    const { data, error } = await withTimeout(
      this.supabase.client.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: window.location.origin,
        },
      }),
      AuthService.requestTimeoutMs,
      'Crearea contului a depășit timpul de așteptare. Verifică conexiunea și încearcă din nou.',
    );

    if (error) {
      throw error;
    }

    return data;
  }

  async signIn(email: string, password: string): Promise<SignInData> {
    const { data, error } = await withTimeout(
      this.supabase.client.auth.signInWithPassword({
        email: email.trim(),
        password,
      }),
      AuthService.requestTimeoutMs,
      'Autentificarea a depășit timpul de așteptare. Verifică conexiunea și încearcă din nou.',
    );

    if (error) {
      throw error;
    }

    this.setCurrentUser(data.user);
    return data;
  }

  async signOut(): Promise<void> {
    const { error } = await this.supabase.client.auth.signOut();
    if (error) {
      throw error;
    }
    this.setCurrentUser(null);
  }

  async requestPasswordReset(email: string): Promise<void> {
    const { error } = await withTimeout(
      this.supabase.client.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      }),
      AuthService.requestTimeoutMs,
      'Trimiterea emailului a depășit timpul de așteptare. Verifică conexiunea și încearcă din nou.',
    );

    if (error) {
      throw error;
    }
  }

  async updatePassword(newPassword: string): Promise<void> {
    if (newPassword.length < 6) {
      throw new Error('Parola nouă trebuie să aibă cel puțin 6 caractere.');
    }

    const { error } = await withTimeout(
      this.supabase.client.auth.updateUser({ password: newPassword }),
      AuthService.requestTimeoutMs,
      'Salvarea parolei a depășit timpul de așteptare. Verifică conexiunea și încearcă din nou.',
    );

    if (error) {
      throw error;
    }
  }

  clearPasswordRecovery(): void {
    this.isPasswordRecovery.set(false);
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const user = this.currentUser();
    if (!user?.email) {
      throw new Error('Autentifică-te din nou pentru a schimba parola.');
    }
    if (newPassword.length < 6) {
      throw new Error('Parola nouă trebuie să aibă cel puțin 6 caractere.');
    }

    const { error: verifyError } = await this.supabase.client.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (verifyError) {
      throw new Error('Parola curentă este incorectă.');
    }

    const { error } = await this.supabase.client.auth.updateUser({ password: newPassword });
    if (error) {
      throw error;
    }
  }

  onUserChanged(listener: (user: User | null) => void): () => void {
    this.userChangeListeners.add(listener);
    listener(this.currentUser());
    return () => this.userChangeListeners.delete(listener);
  }

  private setCurrentUser(user: User | null): void {
    this.currentUser.set(user);
    for (const listener of this.userChangeListeners) {
      listener(user);
    }
  }
}

function hasPasswordRecoveryUrl(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return (
    new URLSearchParams(window.location.search).get('type') === 'recovery' ||
    new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery'
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}
