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
  if (envKey && /^[0-9a-fA-F]{64}$/.test(envKey)) {
    const privateKey = hexToBytes(envKey);
    const publicKeyBase64 = await getPublicKeyBase64(privateKey);
    return {
      privateKey,
      publicKeyBase64,
      privateKeyHex: envKey.toLowerCase(),
    };
  }

  return generateKeyPair();
}

export async function getServerKeyPair(): Promise<ServerKeyPair> {
  if (cachedServerKeyPair) {
    return cachedServerKeyPair;
  }
  if (!keyInitializationPromise) {
    keyInitializationPromise = initServerKeyPair();
  }
  cachedServerKeyPair = await keyInitializationPromise;
  return cachedServerKeyPair;
}

export function resetServerKeyPair(): void {
  cachedServerKeyPair = null;
  keyInitializationPromise = null;
}
