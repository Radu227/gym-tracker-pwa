import { inject, Injectable } from '@angular/core';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { RuntimeConfigService } from './runtime-config.service';

const SUPABASE_REQUEST_TIMEOUT_MS = 12_000;

@Injectable({ providedIn: 'root' })
export class SupabaseClientService {
  private readonly runtimeConfig = inject(RuntimeConfigService);
  private clientInstance: SupabaseClient | null = null;

  get isConfigured(): boolean {
    return this.runtimeConfig.isSupabaseConfigured;
  }

  get client(): SupabaseClient {
    if (!this.isConfigured) {
      throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.');
    }

    this.clientInstance ??= createClient(this.runtimeConfig.supabaseUrl, this.runtimeConfig.supabasePublishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
      global: {
        fetch: fetchWithTimeout,
      },
    });

    return this.clientInstance;
  }
}

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SUPABASE_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Cererea către Supabase a expirat. Verifică internetul și încearcă din nou.', { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
