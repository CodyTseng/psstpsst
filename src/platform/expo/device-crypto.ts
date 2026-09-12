import {
  AESEncryptionKey,
  AESSealedData,
  aesDecryptAsync,
  aesEncryptAsync,
  CryptoDigestAlgorithm,
  digest,
  randomUUID as expoRandomUUID,
} from 'expo-crypto';

import { bytesToHex } from '@/lib/nostr/keys';

import type { DeviceCryptoPort } from '../ports/device-crypto';

/**
 * Device crypto backed by `expo-crypto`: the AES-GCM cipher and SHA-256
 * digest execute asynchronously on a native thread, so a multi-MB attachment
 * blob no longer blocks the single JS thread.
 */
export const deviceCryptoAdapter: DeviceCryptoPort = {
  randomUUID: () => Promise.resolve(expoRandomUUID()),

  async sha256Hex(data) {
    // RN-backed Uint8Arrays are always ArrayBuffer-backed; assert to satisfy
    // `BufferSource` (TS widens `Uint8Array` to `ArrayBufferLike`).
    const buf = await digest(CryptoDigestAlgorithm.SHA256, data as BufferSource);
    return bytesToHex(new Uint8Array(buf));
  },

  async aesGcmEncrypt(plain, key, nonceLength) {
    const encryptionKey = await AESEncryptionKey.import(key);
    const sealed = await aesEncryptAsync(plain, encryptionKey, {
      nonce: { length: nonceLength },
    });
    // `ciphertext || tag` matches the fixed wire format documented on the port.
    const cipher = await sealed.ciphertext({ includeTag: true, encoding: 'bytes' });
    const nonce = await sealed.iv();
    return { cipher, nonce };
  },

  async aesGcmDecrypt(cipher, key, nonce, tagLength) {
    const encryptionKey = await AESEncryptionKey.import(key);
    const sealed = AESSealedData.fromParts(nonce, cipher, tagLength);
    return aesDecryptAsync(sealed, encryptionKey, { output: 'bytes' });
  },

  async aesGcmSeal(plain, key, iv, additionalData) {
    const encryptionKey = await AESEncryptionKey.import(key);
    const sealed = await aesEncryptAsync(plain, encryptionKey, {
      nonce: { bytes: iv },
      tagLength: 16,
      additionalData,
    });
    return sealed.ciphertext({ includeTag: true, encoding: 'bytes' });
  },

  async aesGcmOpen(cipher, key, iv, additionalData) {
    const encryptionKey = await AESEncryptionKey.import(key);
    const sealed = AESSealedData.fromParts(iv, cipher, 16);
    return aesDecryptAsync(sealed, encryptionKey, {
      output: 'bytes',
      additionalData,
    });
  },
};
