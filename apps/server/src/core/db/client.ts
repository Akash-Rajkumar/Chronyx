import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { ChronyxDatabase } from './schema.js';
import { logger } from '../../logger.js';

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

