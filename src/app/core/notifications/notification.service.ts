import { inject, Injectable, signal } from '@angular/core';

import { AuthService } from '../auth/auth.service';
import { RuntimeConfigService } from '../supabase/runtime-config.service';
import { SupabaseClientService } from '../supabase/supabase-client.service';

const LOCAL_NOTIFICATION_KEY = 'gym-tracker:last-inactivity-notification';
const SERVICE_WORKER_TIMEOUT_MS = 10_000;

@Injectable({ providedIn: 'root' })
export class NotificationService {
  readonly isSupported = signal(this.hasNotificationSupport());
  readonly isEnabled = signal(false);
  readonly isChecking = signal(false);
  readonly errorMessage = signal<string | null>(null);

  private readonly auth = inject(AuthService);
  private readonly supabase = inject(SupabaseClientService);
  private readonly runtimeConfig = inject(RuntimeConfigService);

  async initialize(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user || !this.isSupported()) {
      return;
    }

    try {
      const registration = await this.getServiceWorkerRegistration();
      const subscription = await registration.pushManager.getSubscription();
      this.isEnabled.set(subscription !== null);
    } catch {
      this.isEnabled.set(false);
    }
    await this.checkInactivity();
  }

  async enable(): Promise<void> {
    const user = this.auth.currentUser();
    const publicKey = this.runtimeConfig.vapidPublicKey;
    if (!user) {
      throw new Error('Autentifică-te pentru a activa notificările.');
    }
    if (!this.isSupported()) {
      throw new Error('Acest browser nu suportă notificări Web Push.');
    }
    if (!publicKey) {
      throw new Error('Notificările nu sunt configurate încă pe server.');
    }

    this.errorMessage.set(null);
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      this.isEnabled.set(false);
      throw new Error('Permisiunea pentru notificări nu a fost acordată.');
    }

    const registration = await this.getServiceWorkerRegistration();
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      try {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeBase64Url(publicKey) as BufferSource,
        });
      } catch (error) {
        throw new Error(toPushErrorMessage(error), { cause: error });
      }
    }
    const json = subscription.toJSON();
    const p256dh = json.keys?.['p256dh'];
    const auth = json.keys?.['auth'];
    if (!json.endpoint || !p256dh || !auth) {
      throw new Error('Browserul a returnat un abonament Web Push incomplet.');
    }

    const { error } = await this.supabase.client.from('push_subscriptions').upsert(
      {
        user_id: user.id,
        endpoint: json.endpoint,
        p256dh,
        auth,
        user_agent: navigator.userAgent.slice(0, 500),
      },
      { onConflict: 'endpoint' },
    );
    if (error) {
      throw new Error(`Abonamentul nu a putut fi salvat în cloud: ${error.message}`);
    }

    this.isEnabled.set(true);
    await this.checkInactivity();
  }

  async disable(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user || !this.isSupported()) {
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      const { error } = await this.supabase.client
        .from('push_subscriptions')
        .delete()
        .eq('user_id', user.id)
        .eq('endpoint', subscription.endpoint);
      if (error) {
        throw error;
      }
      await subscription.unsubscribe();
    }
    this.isEnabled.set(false);
  }

  async checkInactivity(): Promise<void> {
    const user = this.auth.currentUser();
    if (!user || !this.isSupported() || Notification.permission !== 'granted') {
      return;
    }

    this.isChecking.set(true);
    try {
      const lastActivity = await this.getLastActivityDate(user.id);
      if (!lastActivity) {
        return;
      }

      const today = startOfDay(new Date());
      const lastActivityDay = startOfDay(new Date(`${lastActivity}T12:00:00`));
      const daysInactive = Math.floor((today.getTime() - lastActivityDay.getTime()) / 86_400_000);
      if (daysInactive < 3) {
        return;
      }

      const notificationKey = `${user.id}:${lastActivity}`;
      if (localStorage.getItem(LOCAL_NOTIFICATION_KEY) === notificationKey) {
        return;
      }

      new Notification('Gym Tracker', {
        body: 'Au trecut 3 zile de la ultima ta activitate. Hai să revii la antrenament!',
        icon: '/favicon.ico',
        tag: 'gym-tracker-inactivity',
      });
      localStorage.setItem(LOCAL_NOTIFICATION_KEY, notificationKey);
    } finally {
      this.isChecking.set(false);
    }
  }

  private async getLastActivityDate(userId: string): Promise<string | null> {
    const [{ data: attendance, error: attendanceError }, { data: set, error: setError }] = await Promise.all([
      this.supabase.client
        .from('workout_attendance')
        .select('attendance_date')
        .eq('user_id', userId)
        .order('attendance_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
      this.supabase.client
        .from('workout_set_current')
        .select('performed_at')
        .eq('user_id', userId)
        .eq('is_voided', false)
        .order('performed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (attendanceError) {
      throw attendanceError;
    }
    if (setError) {
      throw setError;
    }

    const attendanceDate = attendance?.attendance_date ?? null;
    const setDate = set?.performed_at ? toDateKey(new Date(set.performed_at)) : null;
    return (
      [attendanceDate, setDate]
        .filter((date): date is string => Boolean(date))
        .sort()
        .at(-1) ?? null
    );
  }

  private hasNotificationSupport(): boolean {
    return (
      typeof window !== 'undefined' &&
      window.isSecureContext &&
      'Notification' in window &&
      'serviceWorker' in navigator &&
      'PushManager' in window
    );
  }

  private async getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
    try {
      return await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<never>((_, reject) => {
          setTimeout(
            () =>
              reject(
                new Error(
                  'Service Worker-ul nu este activ. Instalează aplicația pe HTTPS și încearcă din nou după reîncărcare.',
                ),
              ),
            SERVICE_WORKER_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Service Worker-ul nu a putut fi activat pentru notificări.', { cause: error });
    }
  }
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function toPushErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') {
      return 'Permisiunea pentru notificări a fost blocată. Activeaz-o din setările browserului și încearcă din nou.';
    }
    if (error.name === 'InvalidCharacterError' || error.name === 'TypeError') {
      return 'Cheia publică VAPID nu este validă pe server.';
    }
    if (error.message) {
      return `Notificările Web Push nu au putut fi activate: ${error.message}`;
    }
  }
  if (error instanceof Error && error.message) {
    return `Notificările Web Push nu au putut fi activate: ${error.message}`;
  }
  return 'Notificările Web Push nu au putut fi activate. Verifică permisiunea și conexiunea HTTPS.';
}
