import type { HeartbeatBody, Heartbeat } from '@chronyx/contracts';
import { canonicalJson } from './canonical.js';
import { sha256hex, signHash, verifyHash } from './crypto.js';

export const GENESIS_PREV_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Computes hash of HeartbeatBody:
 * hash = lowercase_hex(sha256(utf8(canonicalJson(body))))
 */
export function computeHeartbeatHash(body: HeartbeatBody): string {
  return sha256hex(canonicalJson(body));
}

/**
 * Signs a heartbeat body, returning complete Heartbeat with hash and sig.
 */
export async function createSignedHeartbeat(
  body: HeartbeatBody,
  secretKey: Uint8Array | string,
): Promise<Heartbeat> {
  const hash = computeHeartbeatHash(body);
  const sig = await signHash(hash, secretKey);
  return {
    ...body,
    hash,
    sig,
  };
}

/**
 * Verifies a heartbeat:
 * 1. Recompute hash from body, must equal heartbeat.hash
 * 2. Signature valid against public key
 * 3. seq == expected_seq
 * 4. prev_hash == expected_prev_hash
 */
export async function verifyHeartbeat(
  heartbeat: Heartbeat,
  publicKeyBase64: string,
  expectedSeq: number,
  expectedPrevHash: string,
): Promise<{
  ok: boolean;
  code?: 'BAD_SIGNATURE' | 'CHAIN_BREAK' | 'BAD_REQUEST';
}> {
  const { hash, sig, ...body } = heartbeat;

  const recomputedHash = computeHeartbeatHash(body);
  if (recomputedHash !== hash) {
    return { ok: false, code: 'BAD_SIGNATURE' };
  }

  const isSigValid = await verifyHash(hash, sig, publicKeyBase64);
  if (!isSigValid) {
    return { ok: false, code: 'BAD_SIGNATURE' };
  }

  if (body.seq !== expectedSeq) {
    return { ok: false, code: 'CHAIN_BREAK' };
  }

  if (body.prev_hash !== expectedPrevHash) {
    return { ok: false, code: 'CHAIN_BREAK' };
  }

  return { ok: true };
}

