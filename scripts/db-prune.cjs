/**
 * DB Prune Script (Part E3)
 * Deletes heartbeats older than 3 hours that have empty flags.
 * (Run around H+10 to stay inside Supabase free tier).
 */
const path = require('path');
const dotenv = require('dotenv');

// 1. Securely load root .env
const envPath = path.resolve(__dirname, '..', '.env');
dotenv.config({ path: envPath });

// Hook TypeScript runtime loader for server module imports
require('tsx/cjs');

const { isDbConfigured } = require('../apps/server/src/core/db/client.ts');
const { pruneHeartbeats } = require('../apps/server/src/core/db/prune.ts');

console.info('=== Chronyx Database Prune Runner ===');
console.info("Rule: Deletes heartbeats older than 3 hours with empty flags (flags = '{}').");

if (!isDbConfigured()) {
  console.error('[PRUNE ERROR] Supabase is not configured or uses placeholder credentials.');
  process.exit(1);
}

const nowMs = Date.now();
const threeHoursMs = 3 * 60 * 60 * 1000;
const cutoffMs = nowMs - threeHoursMs;
const cutoffIso = new Date(cutoffMs).toISOString();

console.info(`Current timestamp: ${nowMs} (${new Date(nowMs).toISOString()})`);
console.info(`Cutoff timestamp:  ${cutoffMs} (${cutoffIso})`);
console.info("Target table:      'heartbeats'");
console.info(`Deletion filter:   t_rx_ms < ${cutoffMs} AND flags = '{}'`);

async function run() {
  try {
    const result = await pruneHeartbeats(nowMs);
    if (!result.success) {
      console.error(`[PRUNE FAILED] ${result.error || 'Database operation failed'}`);
      process.exit(1);
    }

    console.info(`[PRUNE COMPLETE] Successfully deleted ${result.deletedCount} eligible row(s).`);
    console.info('Flagged heartbeats and heartbeats within the last 3 hours were protected.');
    process.exit(0);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[PRUNE ERROR] Execution failed: ${errorMsg}`);
    process.exit(1);
  }
}

run();
