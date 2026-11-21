// TEST-FIXTURE
import { describe, it, expect } from 'vitest';
import {
  canonicalJson,
  sha256hex,
  signHash,
  verifyHash,
  generateKeyPair,
  getPublicKeyBase64,
  computeHeartbeatHash,
  createSignedHeartbeat,
  verifyHeartbeat,
  GENESIS_PREV_HASH,
} from '../index.js';
import type { HeartbeatBody } from '@chronyx/contracts';

describe('packages/crypto golden vectors & chain tests', () => {
  it('canonicalJson: deterministic ascending key sort and formatting (synchronous)', () => {
    const input1 = { z: 1, a: 'test', m: { y: 2, b: 3 } };
    const input2 = { a: 'test', m: { b: 3, y: 2 }, z: 1 };
    const result = canonicalJson(input1);
    // Explicitly verify synchronous return type (string, not Promise)
    expect(typeof result).toBe('string');
    expect(result).toBe('{"a":"test","m":{"b":3,"y":2},"z":1}');
    expect(result).toBe(canonicalJson(input2));
  });

  it('sha256hex: known test vector (synchronous)', () => {
    const hash = sha256hex('');
    // Explicitly verify synchronous return type (string, not Promise)
    expect(typeof hash).toBe('string');
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  describe('Ed25519 Key Handling & Asynchronous API', () => {
    it('generateKeyPair produces valid private and public keys', async () => {
      const kp = await generateKeyPair();
      expect(kp.privateKey).toBeInstanceOf(Uint8Array);
      expect(kp.privateKey.length).toBe(32);
      expect(typeof kp.publicKeyBase64).toBe('string');
      expect(typeof kp.privateKeyHex).toBe('string');
      expect(kp.privateKeyHex.length).toBe(64);

      // getPublicKeyBase64 matches derived public key
      const derivedPub = await getPublicKeyBase64(kp.privateKey);
      expect(derivedPub).toBe(kp.publicKeyBase64);

      const derivedFromHex = await getPublicKeyBase64(kp.privateKeyHex);
      expect(derivedFromHex).toBe(kp.publicKeyBase64);
    });

    it('signHash and verifyHash are asynchronous Promises', async () => {
      const keyPair = await generateKeyPair();
      const message = 'test-async-promise-structure';
      const hash = sha256hex(message);

      const signPromise = signHash(hash, keyPair.privateKey);
      expect(signPromise).toBeInstanceOf(Promise);
      const sig = await signPromise;
      expect(typeof sig).toBe('string');

      const verifyPromise = verifyHash(hash, sig, keyPair.publicKeyBase64);
      expect(verifyPromise).toBeInstanceOf(Promise);
      const valid = await verifyPromise;
      expect(valid).toBe(true);
    });

    it('validates authentic signatures and rejects modified message / tampered signature', async () => {
      const keyPair = await generateKeyPair();
      const message = 'golden-vector-test-message';
      const hash = sha256hex(message);

      const sig = await signHash(hash, keyPair.privateKey);
      const valid = await verifyHash(hash, sig, keyPair.publicKeyBase64);
      expect(valid).toBe(true);

      // Modified message / hash rejection
      const tamperedHash = sha256hex(message + '-tampered');
      const invalidMsg = await verifyHash(tamperedHash, sig, keyPair.publicKeyBase64);
      expect(invalidMsg).toBe(false);

      // Modified signature rejection
      const tamperedSig = sig.slice(0, -4) + 'AAAA';
      const invalidSig = await verifyHash(hash, tamperedSig, keyPair.publicKeyBase64);
      expect(invalidSig).toBe(false);

      // Completely invalid signature string rejection
      const malformedSig = await verifyHash(hash, 'not-a-valid-base64!', keyPair.publicKeyBase64);
      expect(malformedSig).toBe(false);

      // Wrong public key rejection
      const otherKeyPair = await generateKeyPair();
      const wrongKey = await verifyHash(hash, sig, otherKeyPair.publicKeyBase64);
      expect(wrongKey).toBe(false);
    });
  });

  describe('No-Web-Crypto Isolation (Simulated HTTP / Non-Secure Context on LAN)', () => {
    it('signs, derives public keys, and verifies without crypto.subtle dependency', async () => {
      // Simulate absence of crypto.subtle (as occurs on plain HTTP in mobile browsers)
      const hasSubtleBefore = globalThis.crypto?.subtle !== undefined;
      expect(hasSubtleBefore).toBe(true);

      // Shadow crypto.subtle
      Object.defineProperty(globalThis.crypto, 'subtle', {
        value: undefined,
        configurable: true,
        writable: true,
      });

      try {
        expect(globalThis.crypto.subtle).toBeUndefined();

        // 1. Generate keypair without subtle
        const keyPair = await generateKeyPair();
        expect(keyPair.publicKeyBase64).toBeDefined();

        // 2. Sign without subtle
        const testPayload = 'lan-http-payload-without-subtle';
        const hash = sha256hex(testPayload);
        const sig = await signHash(hash, keyPair.privateKey);
        expect(typeof sig).toBe('string');

        // 3. Verify valid signature without subtle
        const isValid = await verifyHash(hash, sig, keyPair.publicKeyBase64);
        expect(isValid).toBe(true);

        // 4. Reject tampered signature without subtle
        const tamperedSig = sig.slice(0, -4) + 'AAAA';
        const isTamperedValid = await verifyHash(hash, tamperedSig, keyPair.publicKeyBase64);
        expect(isTamperedValid).toBe(false);

        // 5. Verify full heartbeat lifecycle without subtle
        const body: HeartbeatBody = {
          node_id: '22222222-2222-2222-2222-222222222222',
          seq: 0,
          t_local_ms: 1700000000000,
          prev_hash: GENESIS_PREV_HASH,
          exchange: [],
          osc_residual_ms: null,
          health: null,
        };

        const signedHb = await createSignedHeartbeat(body, keyPair.privateKey);
        const hbResult = await verifyHeartbeat(signedHb, keyPair.publicKeyBase64, 0, GENESIS_PREV_HASH);
        expect(hbResult.ok).toBe(true);
      } finally {
        // Cleanly unshadow and restore global crypto.subtle
        delete (globalThis.crypto as unknown as Record<string, unknown>).subtle;
        expect(globalThis.crypto?.subtle !== undefined).toBe(true);
      }
    });
  });

  describe('Heartbeat Chain Verification & Tamper Detection', () => {
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
});
