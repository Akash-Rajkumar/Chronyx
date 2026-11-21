import { createRequire } from 'module';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { ChronyxDatabase } from './schema.js';
import { logger } from '../../logger.js';

const require = createRequire(import.meta.url);

// In Node.js < 22, @supabase/realtime-js requires a WebSocket implementation on globalThis
if (typeof globalThis.WebSocket === 'undefined') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).WebSocket = require('ws');
  } catch {
    // fallback if ws is not resolvable
  }
}

let cachedClient: SupabaseClient<ChronyxDatabase> | null = null;

export function isDbConfigured(): boolean {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return Boolean(url && key && url !== 'https://your-project.supabase.co' && !url.includes('example'));
}

export function getDbClient(): SupabaseClient<ChronyxDatabase> | null {
  if (cachedClient) {
    return cachedClient;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return null;
  }

  try {
    cachedClient = createClient<ChronyxDatabase>(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    return cachedClient;
  } catch (err) {
    logger.error(err, 'Failed to initialize Supabase client');
    return null;
  }
}

