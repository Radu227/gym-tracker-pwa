import { Injectable } from '@angular/core';

interface RuntimeConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
  vapidPublicKey?: string;
}

@Injectable({ providedIn: 'root' })
export class RuntimeConfigService {
  private config: RuntimeConfig | null = null;

  get supabaseUrl(): string {
    return this.config?.supabaseUrl ?? '';
  }

  get supabasePublishableKey(): string {
    return this.config?.supabasePublishableKey ?? '';
  }

  get vapidPublicKey(): string {
    return this.config?.vapidPublicKey ?? '';
  }

  get isSupabaseConfigured(): boolean {
    return Boolean(this.config?.supabaseUrl && this.config.supabasePublishableKey);
  }

  async load(): Promise<void> {
    const response = await fetch('/runtime-config.json', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Could not load runtime configuration (${response.status})`);
    }

    const value: unknown = await response.json();
    if (!isRuntimeConfig(value)) {
      throw new Error('Runtime configuration has an invalid shape');
    }

    this.config = {
      supabaseUrl: value.supabaseUrl.trim(),
      supabasePublishableKey: value.supabasePublishableKey.trim(),
      vapidPublicKey: value.vapidPublicKey?.trim() ?? '',
    };
  }
}

function isRuntimeConfig(value: unknown): value is RuntimeConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    'supabaseUrl' in value &&
    typeof value.supabaseUrl === 'string' &&
    'supabasePublishableKey' in value &&
    typeof value.supabasePublishableKey === 'string'
  );
}
