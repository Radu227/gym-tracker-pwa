import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const localEnvPath = resolve(projectRoot, '.env.local');

function readLocalEnv(path) {
  if (!existsSync(path)) {
    return {};
  }

  const values = {};
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) {
      continue;
    }

    const [, name, rawValue] = match;
    const value = rawValue.replace(/^(['"])(.*)\1$/, '$2');
    values[name] = value;
  }

  return values;
}

const localValues = readLocalEnv(localEnvPath);
const configuredSupabaseUrl = (process.env.SUPABASE_URL ?? localValues.SUPABASE_URL ?? '').trim();
const publishableKey = (process.env.SUPABASE_PUBLISHABLE_KEY ?? localValues.SUPABASE_PUBLISHABLE_KEY ?? '').trim();
const vapidPublicKey = (process.env.VAPID_PUBLIC_KEY ?? localValues.VAPID_PUBLIC_KEY ?? '').trim();

if (Boolean(configuredSupabaseUrl) !== Boolean(publishableKey)) {
  throw new Error('Set both SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY, or leave both empty.');
}

let supabaseUrl = configuredSupabaseUrl;
if (supabaseUrl) {
  let url;
  try {
    url = new URL(supabaseUrl);
  } catch {
    throw new Error('SUPABASE_URL must be a valid absolute URL.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('SUPABASE_URL must use HTTP or HTTPS.');
  }

  if (url.pathname === '/rest/v1' || url.pathname === '/rest/v1/') {
    url.pathname = '/';
    url.search = '';
    url.hash = '';
    supabaseUrl = url.toString().replace(/\/$/, '');
    console.warn('Removed /rest/v1 from SUPABASE_URL so Supabase Auth can use the project URL.');
  } else if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('SUPABASE_URL must be the project URL, for example https://your-project.supabase.co.');
  }

  if (publishableKey.startsWith('sb_secret_')) {
    throw new Error('A secret Supabase key cannot be exposed to the browser. Use the publishable key.');
  }

  const keyParts = publishableKey.split('.');
  if (keyParts.length === 3) {
    let claims;
    try {
      claims = JSON.parse(Buffer.from(keyParts[1], 'base64url').toString('utf8'));
    } catch {
      throw new Error('The Supabase JWT key is malformed.');
    }

    if (claims.role === 'service_role') {
      throw new Error('The service_role key cannot be exposed to the browser. Use the anon or publishable key.');
    }
  }
}

const runtimeConfig = {
  supabaseUrl,
  supabasePublishableKey: publishableKey,
  vapidPublicKey,
};
const outputPath = resolve(projectRoot, 'public', 'runtime-config.json');
writeFileSync(outputPath, `${JSON.stringify(runtimeConfig, null, 2)}\n`, 'utf8');

console.log(`Generated runtime config (${supabaseUrl ? 'Supabase configured' : 'offline-only mode'}).`);
