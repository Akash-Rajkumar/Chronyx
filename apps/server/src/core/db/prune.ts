import { getRepositories, isDbConfigured } from './index.js';
import { logger } from '../../logger.js';

export interface PruneResult {
  success: boolean;
  deletedCount: number;
  cutoffMs: number;
  error?: string;
}

/**
 * Prunes heartbeats older than 3 hours that have empty flags.
 * Part E3: "A script npm run db:prune deletes heartbeats older than 3 hours that have empty flags (run it around H+10 to stay inside the free tier)."
 * 3 hours = 3 * 60 * 60 * 1000 ms = 10,800,000 ms.
 */
export async function pruneHeartbeats(nowMs = Date.now()): Promise<PruneResult> {
  const threeHoursMs = 3 * 60 * 60 * 1000;
  const cutoffMs = nowMs - threeHoursMs;

  if (!isDbConfigured()) {
    return {
      success: false,
      deletedCount: 0,
      cutoffMs,
      error: 'SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY not configured.',
    };
  }

  const db = getRepositories();
  if (!db) {
    return {
      success: false,
      deletedCount: 0,
      cutoffMs,
      error: 'Failed to obtain database repositories.',
    };
  }

  try {
    const deletedCount = await db.heartbeats.pruneOlderThan(cutoffMs);
    logger.info({ deletedCount, cutoffMs }, 'Pruned heartbeats older than 3 hours with empty flags');
    return {
      success: true,
      deletedCount,
      cutoffMs,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, `Failed to prune heartbeats: ${errorMsg}`);
    throw err;
  }
}
