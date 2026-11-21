/**
 * Database Verification Script (P1-T2)
 * Connects to Supabase, inserts a test node, reads it back,
 * inserts a referencing test heartbeat, reads it back, and cleans up.
 */
import dotenv from 'dotenv';
dotenv.config();

import { getRepositories, isDbConfigured } from './index.js';
import { GENESIS_PREV_HASH } from '@chronyx/contracts';

export interface DbVerificationResult {
  connected: boolean;
  nodeInserted?: boolean;
  nodeId?: string;
  nodeRead?: boolean;
  heartbeatInserted?: boolean;
  heartbeatId?: number;
  heartbeatRead?: boolean;
  cleanedUp?: boolean;
  error?: string;
}

export async function runDbVerification(): Promise<DbVerificationResult> {
  console.info('=== Chronyx P1-T2 Database Foundation Verification ===');

  if (!isDbConfigured()) {
    const errorMsg = 'BLOCKER: SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY are not configured locally.';
    console.warn(errorMsg);
    return {
      connected: false,
      error: errorMsg,
    };
  }

  const db = getRepositories();
  if (!db) {
    const errorMsg = 'BLOCKER: Failed to initialize Supabase client with provided credentials.';
    console.error(errorMsg);
    return {
      connected: false,
      error: errorMsg,
    };
  }

  console.info('1. Supabase client initialized. Testing connectivity...');

  const result: DbVerificationResult = {
    connected: true,
  };

  let testNodeId: string | null = null;
  let testHeartbeatId: number | null = null;

  try {
    // Step 2: Insert a valid test node
    const testPublicKey = `verify_pk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    console.info('2. Inserting test node...');
    const insertedNode = await db.nodes.create({
      name: `Verification-Node-${Date.now()}`,
      kind: 'browser',
      public_key: testPublicKey,
    });
    testNodeId = insertedNode.id;
    result.nodeInserted = true;
    result.nodeId = testNodeId;
    console.info(`   -> Test node inserted with ID: ${testNodeId}`);

    // Step 3: Read that node back and verify values
    console.info('3. Reading test node back...');
    const fetchedNode = await db.nodes.findById(testNodeId);
    if (!fetchedNode || fetchedNode.public_key !== testPublicKey) {
      throw new Error(`Node verification failed: fetched node does not match inserted values.`);
    }
    result.nodeRead = true;
    console.info('   -> Node read back and verified successfully.');

    // Step 4: Insert a valid heartbeat referencing that node
    console.info('4. Inserting test heartbeat...');
    const now = Date.now();
    const insertedHb = await db.heartbeats.create({
      node_id: testNodeId,
      seq: 0,
      t_local_ms: now,
      t_rx_ms: now + 5,
      prev_hash: GENESIS_PREV_HASH,
      hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      sig: 'dGVzdF9zaWduYXR1cmU=',
      body: { verify: true },
      flags: ['VERIFY_TEST'],
    });
    testHeartbeatId = insertedHb.id;
    result.heartbeatInserted = true;
    result.heartbeatId = testHeartbeatId;
    console.info(`   -> Test heartbeat inserted with ID: ${testHeartbeatId}`);

    // Step 5: Read that heartbeat back and verify values
    console.info('5. Reading test heartbeat back...');
    const fetchedHb = await db.heartbeats.findByNodeAndSeq(testNodeId, 0);
    if (!fetchedHb || fetchedHb.id !== testHeartbeatId) {
      throw new Error('Heartbeat verification failed: fetched heartbeat does not match inserted values.');
    }
    result.heartbeatRead = true;
    console.info('   -> Heartbeat read back and verified successfully.');

    // Step 6: Clean up records created by verification
    console.info('6. Cleaning up test records...');
    await db.heartbeats.deleteById(testHeartbeatId);
    await db.nodes.deleteById(testNodeId);
    result.cleanedUp = true;
    console.info('   -> Cleanup completed successfully.');

    console.info('=== All database verification operations PASSED ===');
    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`Database verification error: ${errorMsg}`);
    result.error = errorMsg;

    // Attempt cleanup on failure
    if (testHeartbeatId) {
      await db.heartbeats.deleteById(testHeartbeatId).catch(() => {});
    }
    if (testNodeId) {
      await db.nodes.deleteById(testNodeId).catch(() => {});
    }

    return result;
  }
}

// Direct execution support
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('verifyDb.ts')) {
  runDbVerification()
    .then((res) => {
      if (!res.connected || res.error) {
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

