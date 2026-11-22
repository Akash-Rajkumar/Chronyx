import { generateKeyPair } from '@chronyx/crypto';

export interface NodeIdentityMetadata {
  nodeId?: string; // Assigned by Gateway upon registration
  nodeName: string;
  publicKeyBase64?: string;
}

export interface NodeIdentity {
  nodeId?: string;
  nodeName: string;
  publicKeyBase64: string;
}

export interface NodeKeyMaterial {
  publicKeyBase64: string;
  privateKeyHex: string;
}

const DEFAULT_STORAGE_KEY = 'chronyx_browser_node_identity';
const inMemoryStore: Record<string, string> = {};

function safeGetStorage(key: string): string | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(key);
    }
  } catch {
    // LocalStorage might be disabled or restricted in private mode
  }
  return inMemoryStore[key] ?? null;
}

function safeSetStorage(key: string, val: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, val);
      return;
    }
  } catch {
    // LocalStorage write failed or blocked
  }
  inMemoryStore[key] = val;
}

function safeRemoveStorage(key: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(key);
      return;
    }
  } catch {
    // Ignore error
  }
  delete inMemoryStore[key];
}

/**
 * Loads persisted non-secret metadata from storage (nodeName, nodeId, publicKey).
 * Strictly NEVER reads or expects private keys from localStorage.
 */
export function loadIdentityMetadata(storageKey = DEFAULT_STORAGE_KEY): NodeIdentityMetadata | null {
  const existing = safeGetStorage(storageKey);
  if (!existing) return null;

  try {
    const parsed = JSON.parse(existing) as Record<string, unknown>;
    if (typeof parsed.nodeName === 'string') {
      return {
        nodeName: parsed.nodeName,
        nodeId: typeof parsed.nodeId === 'string' ? parsed.nodeId : undefined,
        publicKeyBase64: typeof parsed.publicKeyBase64 === 'string' ? parsed.publicKeyBase64 : undefined,
      };
    }
  } catch {
    // Corrupt storage entry
  }
  return null;
}

/**
 * Persists ONLY non-secret metadata to storage (nodeName, nodeId, publicKeyBase64).
 * Strips all private key material to guarantee private keys are NEVER written to localStorage.
 */
export function saveIdentity(
  identity: { nodeId?: string; nodeName: string; publicKeyBase64?: string },
  storageKey = DEFAULT_STORAGE_KEY,
): void {
  safeSetStorage(
    storageKey,
    JSON.stringify({
      nodeId: identity.nodeId,
      nodeName: identity.nodeName,
      publicKeyBase64: identity.publicKeyBase64,
    }),
  );
}

/**
 * Generates fresh in-memory Ed25519 key material for the active session.
 * Private key bytes remain exclusively in memory during the active tab session.
 */
export async function createSessionKeyMaterial(): Promise<NodeKeyMaterial> {
  const keys = await generateKeyPair();
  return {
    publicKeyBase64: keys.publicKeyBase64,
    privateKeyHex: keys.privateKeyHex,
  };
}

/**
 * Initializes node identity with fresh session key material and saves non-secret metadata.
 * Private key is never persisted to storage.
 */
export async function loadOrCreateIdentity(
  nodeName = 'Judge-Node',
  storageKey = DEFAULT_STORAGE_KEY,
): Promise<{ identity: NodeIdentity; keyMaterial: NodeKeyMaterial }> {
  const existingMeta = loadIdentityMetadata(storageKey);
  const keyMaterial = await createSessionKeyMaterial();

  const identity: NodeIdentity = {
    nodeId: undefined, // Fresh session key requires registration with Gateway
    nodeName: existingMeta?.nodeName || nodeName,
    publicKeyBase64: keyMaterial.publicKeyBase64,
  };

  // Persist only non-secret metadata
  saveIdentity(identity, storageKey);

  return { identity, keyMaterial };
}

/**
 * Clears persisted identity metadata from storage.
 */
export function clearIdentity(storageKey = DEFAULT_STORAGE_KEY): void {
  safeRemoveStorage(storageKey);
}
