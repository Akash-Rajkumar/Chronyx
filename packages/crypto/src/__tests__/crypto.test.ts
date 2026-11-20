// TEST-FIXTURE
import { describe, it, expect } from 'vitest';
import {
  canonicalJson,
  sha256hex,
  signHash,
  verifyHash,
  generateKeyPair,
  computeHeartbeatHash,
  createSignedHeartbeat,
  verifyHeartbeat,
  GENESIS_PREV_HASH,
} from '../index.js';
import type { HeartbeatBody } from '@chronyx/contracts';

describe('packages/crypto golden vectors & chain tests', () => {
  it('canonicalJson: deterministic ascending key sort and formatting', () => {
    const input1 = { z: 1, a: 'test', m: { y: 2, b: 3 } };
    const input2 = { a: 'test', m: { b: 3, y: 2 }, z: 1 };
    expect(canonicalJson(input1)).toBe('{"a":"test","m":{"b":3,"y":2},"z":1}');
    expect(canonicalJson(input1)).toBe(canonicalJson(input2));
  });

  it('sha256hex: known test vector', () => {
    expect(sha256hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('signHash and verifyHash with ed25519', async () => {
    const keyPair = await generateKeyPair();
    const message = 'golden-vector-test-message';
    const hash = sha256hex(message);

    const sig = await signHash(hash, keyPair.privateKey);
    const valid = await verifyHash(hash, sig, keyPair.publicKeyBase64);
    expect(valid).toBe(true);

    const invalid = await verifyHash(hash + 'x', sig, keyPair.publicKeyBase64);
    expect(invalid).toBe(false);
  });

  it('heartbeat creation, hash chain verification, and tamper detection', async () => {
    const keyPair = await generateKeyPair();

    const body0: HeartbeatBody = {
      node_id: '11111111-1111-1111-1111-111111111111',
      seq: 0,
      t_local_ms: 1700000000000,
      prev_hash: GENESIS_PREV_HASH,
      exchange: [{ t1: 10, t2: 15, t3: 16, t4: 21 }],
      osc_residual_ms: 0.05,
      health: { cn0_dbhz: 45.0, agc_db: 20.0 },
    };

    const hb0 = await createSignedHeartbeat(body0, keyPair.privateKey);
    expect(hb0.prev_hash).toBe(GENESIS_PREV_HASH);
    expect(hb0.hash).toBe(computeHeartbeatHash(body0));

    // Verification against expected seq 0 and genesis prev hash
    const res0 = await verifyHeartbeat(hb0, keyPair.publicKeyBase64, 0, GENESIS_PREV_HASH);
    expect(res0.ok).toBe(true);

    // Tampered seq
    const resSeqMismatch = await verifyHeartbeat(hb0, keyPair.publicKeyBase64, 1, GENESIS_PREV_HASH);
    expect(resSeqMismatch.ok).toBe(false);
    expect(resSeqMismatch.code).toBe('CHAIN_BREAK');

    // Tampered body payload
    const tamperedHb = { ...hb0, t_local_ms: 1700000000999 };
    const resTampered = await verifyHeartbeat(
      tamperedHb,
      keyPair.publicKeyBase64,
      0,
      GENESIS_PREV_HASH,
    );
    expect(resTampered.ok).toBe(false);
    expect(resTampered.code).toBe('BAD_SIGNATURE');

    // Next heartbeat in chain
    const body1: HeartbeatBody = {
      node_id: '11111111-1111-1111-1111-111111111111',
      seq: 1,
      t_local_ms: 1700000001000,
      prev_hash: hb0.hash,
      exchange: [{ t1: 1010, t2: 1015, t3: 1016, t4: 1021 }],
      osc_residual_ms: 0.06,
      health: { cn0_dbhz: 45.1, agc_db: 20.0 },
    };

    const hb1 = await createSignedHeartbeat(body1, keyPair.privateKey);
    const res1 = await verifyHeartbeat(hb1, keyPair.publicKeyBase64, 1, hb0.hash);
    expect(res1.ok).toBe(true);
  });
});
