import { generateKeyPair } from '@chronyx/crypto';

export interface ServerKeyPair {
  privateKey: Uint8Array;
  publicKeyBase64: string;
  privateKeyHex: string;
}

let cachedServerKeyPair: ServerKeyPair | null = null;

export async function getServerKeyPair(): Promise<ServerKeyPair> {
  if (!cachedServerKeyPair) {
    cachedServerKeyPair = await generateKeyPair();
  }
  return cachedServerKeyPair;
}

export function resetServerKeyPair(): void {
  cachedServerKeyPair = null;
}
