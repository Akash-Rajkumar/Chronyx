import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadOrCreateIdentity,
  saveIdentity,
  loadIdentityMetadata,
  clearIdentity,
} from '../identity.js';

describe('Browser Node Identity Security & In-Memory Keys (P3-T2)', () => {
  const TEST_STORAGE_KEY = 'test_chronyx_identity_security';

  beforeEach(() => {
    clearIdentity(TEST_STORAGE_KEY);
  });

  it('generates valid in-memory Ed25519 key material with public key base64', async () => {
    const { identity, keyMaterial } = await loadOrCreateIdentity('Test-Node', TEST_STORAGE_KEY);

    expect(identity.nodeName).toBe('Test-Node');
    expect(identity.publicKeyBase64).toBeDefined();
    expect(identity.publicKeyBase64.length).toBe(44);

    expect(keyMaterial.privateKeyHex).toBeDefined();
    expect(keyMaterial.privateKeyHex.length).toBe(64);
    expect(keyMaterial.publicKeyBase64).toBe(identity.publicKeyBase64);
  });

  it('strictly NEVER persists private key material to localStorage', async () => {
    const { identity, keyMaterial } = await loadOrCreateIdentity('Secret-Test-Node', TEST_STORAGE_KEY);

    // Read raw storage content directly
    const rawStored = typeof window !== 'undefined' && window.localStorage
      ? window.localStorage.getItem(TEST_STORAGE_KEY)
      : null;

    if (rawStored) {
      expect(rawStored).not.toContain('privateKeyHex');
      expect(rawStored).not.toContain(keyMaterial.privateKeyHex);
      expect(rawStored).toContain('Secret-Test-Node');
      expect(rawStored).toContain(identity.publicKeyBase64);
    }

    // Even if an object with privateKeyHex is cast to saveIdentity, it must not be stored
    const objectWithSecret = {
      nodeName: 'Attempt-Leak-Node',
      nodeId: '12345678-1234-1234-1234-123456789abc',
      publicKeyBase64: identity.publicKeyBase64,
      privateKeyHex: keyMaterial.privateKeyHex,
    };
    saveIdentity(objectWithSecret as unknown as { nodeId?: string; nodeName: string; publicKeyBase64?: string }, TEST_STORAGE_KEY);

    const reloadedMeta = loadIdentityMetadata(TEST_STORAGE_KEY);
    expect(reloadedMeta).toBeDefined();
    expect(reloadedMeta?.nodeName).toBe('Attempt-Leak-Node');
    expect(reloadedMeta?.nodeId).toBe('12345678-1234-1234-1234-123456789abc');
    expect((reloadedMeta as unknown as Record<string, unknown>).privateKeyHex).toBeUndefined();
  });

  it('clears persisted identity metadata upon request', async () => {
    await loadOrCreateIdentity('Clear-Node', TEST_STORAGE_KEY);
    expect(loadIdentityMetadata(TEST_STORAGE_KEY)).not.toBeNull();

    clearIdentity(TEST_STORAGE_KEY);
    expect(loadIdentityMetadata(TEST_STORAGE_KEY)).toBeNull();
  });
});
