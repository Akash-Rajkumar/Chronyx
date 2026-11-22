import { generateKeyPair, getPublicKeyBase64, hexToBytes } from '@chronyx/crypto';

export interface ServerKeyPair {
  privateKey: Uint8Array;
  publicKeyBase64: string;
  privateKeyHex: string;
}

let cachedServerKeyPair: ServerKeyPair | null = null;
let keyInitializationPromise: Promise<ServerKeyPair> | null = null;

async function initServerKeyPair(): Promise<ServerKeyPair> {
  const envKey = process.env.SERVER_SIGNING_KEY?.trim();

  if (envKey) {
    if (!/^[0-9a-fA-F]{64}$/.test(envKey)) {
      throw new Error('SERVER_SIGNING_KEY is malformed: must be a 64-character hexadecimal seed');
    }
    const privateKey = hexToBytes(envKey);
    const publicKeyBase64 = await getPublicKeyBase64(privateKey);
    return {
      privateKey,
      publicKeyBase64,
      privateKeyHex: envKey.toLowerCase(),
    };
  }

  // Fail-closed in production if signing key is missing
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SERVER_SIGNING_KEY is required in production environment');
  }

  // Permitted ephemeral key generation for local development and test environments
  return generateKeyPair();
}

export async function getServerKeyPair(): Promise<ServerKeyPair> {
  if (cachedServerKeyPair) {
    return cachedServerKeyPair;
  }
  if (!keyInitializationPromise) {
    keyInitializationPromise = initServerKeyPair().catch((err) => {
      keyInitializationPromise = null;
      throw err;
    });
  }
  cachedServerKeyPair = await keyInitializationPromise;
  return cachedServerKeyPair;
}

export function resetServerKeyPair(): void {
  cachedServerKeyPair = null;
  keyInitializationPromise = null;
}
