import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

// Configure pure-JS SHA-512 explicitly for @noble/ed25519 to avoid crypto.subtle dependency (D-001)
const sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));
ed.etc.sha512Sync = sha512Sync;
ed.etc.sha512Async = (...m: Uint8Array[]) => Promise.resolve(sha512Sync(...m));

export function utf8ToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

export function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export { bytesToHex, hexToBytes };

/**
 * SHA-256 lowercase hex of string or bytes.
 */
export function sha256hex(data: string | Uint8Array): string {
  const bytes = typeof data === 'string' ? utf8ToBytes(data) : data;
  return bytesToHex(sha256(bytes));
}

/**
 * Helper to normalize hash input (64 hex characters or 32 raw bytes) to Uint8Array.
 */
function normalizeHashToBytes(hash: string | Uint8Array): Uint8Array {
  if (typeof hash === 'string') {
    if (hash.length === 64 && /^[0-9a-fA-F]+$/.test(hash)) {
      return hexToBytes(hash);
    }
    return utf8ToBytes(hash);
  }
  return hash;
}

/**
 * Generate Ed25519 keypair.
 * Returns secret_key (hex or 32 bytes) and public_key (base64).
 */
export async function generateKeyPair(): Promise<{
  privateKey: Uint8Array;
  publicKeyBase64: string;
  privateKeyHex: string;
}> {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  return {
    privateKey: priv,
    publicKeyBase64: bytesToBase64(pub),
    privateKeyHex: bytesToHex(priv),
  };
}

/**
 * Derive public key base64 from 32-byte secret key (Uint8Array or hex).
 */
export async function getPublicKeyBase64(secretKey: Uint8Array | string): Promise<string> {
  const privBytes = typeof secretKey === 'string' ? hexToBytes(secretKey) : secretKey;
  const pub = await ed.getPublicKeyAsync(privBytes);
  return bytesToBase64(pub);
}

/**
 * Sign hash using Ed25519 (Async API).
 * Returns base64 signature.
 */
export async function signHash(
  hash: string | Uint8Array,
  secretKey: Uint8Array | string,
): Promise<string> {
  const msgBytes = normalizeHashToBytes(hash);
  const privBytes = typeof secretKey === 'string' ? hexToBytes(secretKey) : secretKey;
  const sigBytes = await ed.signAsync(msgBytes, privBytes);
  return bytesToBase64(sigBytes);
}

/**
 * Verify Ed25519 signature over hash (Async API).
 */
export async function verifyHash(
  hash: string | Uint8Array,
  sigBase64: string,
  publicKeyBase64: string,
): Promise<boolean> {
  try {
    const msgBytes = normalizeHashToBytes(hash);
    const sigBytes = base64ToBytes(sigBase64);
    const pubBytes = base64ToBytes(publicKeyBase64);
    return await ed.verifyAsync(sigBytes, msgBytes, pubBytes);
  } catch {
    return false;
  }
}

