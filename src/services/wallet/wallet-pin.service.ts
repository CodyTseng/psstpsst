import { scryptAsync } from '@noble/hashes/scrypt.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

import { platform } from '@/platform';

const PIN_PATTERN = /^\d{6}$/;
const SCRYPT_OPTIONS = { N: 1 << 15, r: 8, p: 1, dkLen: 32, asyncTick: 10 } as const;
const AUTHORIZATION_TTL_MS = 60_000;
const authorizations = new Map<string, { accountPubkey: string; expiresAt: number }>();

type PinRecord = {
  version: 1;
  salt: string;
  digest: string;
};

function walletPinKey(accountPubkey: string): string {
  return `psstpsst.wallet.pin.${accountPubkey}`;
}

export async function walletAuthenticationMode(
  accountPubkey: string,
): Promise<'system' | 'pin' | 'pin_setup_required'> {
  const enrolled = await platform.localAuth.hasEnrolledAuth().catch(() => false);
  if (enrolled) return 'system';
  return (await hasWalletPin(accountPubkey)) ? 'pin' : 'pin_setup_required';
}

export async function hasWalletPin(accountPubkey: string): Promise<boolean> {
  return (await platform.secureStorage.getItem(walletPinKey(accountPubkey))) !== null;
}

export async function setWalletPin(accountPubkey: string, pin: string): Promise<void> {
  if (!PIN_PATTERN.test(pin)) throw new Error('Wallet PIN must contain exactly 6 digits');
  const salt = await platform.deviceCrypto.randomUUID();
  const digest = await scryptAsync(pin, salt, SCRYPT_OPTIONS);
  const record: PinRecord = { version: 1, salt, digest: bytesToHex(digest) };
  await platform.secureStorage.setItem(walletPinKey(accountPubkey), JSON.stringify(record));
}

export async function authorizeWalletPin(
  accountPubkey: string,
  pin: string,
): Promise<string | null> {
  if (!(await verifyWalletPin(accountPubkey, pin))) return null;
  const now = Date.now();
  for (const [existingToken, authorization] of authorizations) {
    if (authorization.expiresAt < now) authorizations.delete(existingToken);
  }
  const token = await platform.deviceCrypto.randomUUID();
  authorizations.set(token, { accountPubkey, expiresAt: now + AUTHORIZATION_TTL_MS });
  return token;
}

export function consumeWalletPinAuthorization(accountPubkey: string, token: string): boolean {
  const authorization = authorizations.get(token);
  authorizations.delete(token);
  return (
    authorization?.accountPubkey === accountPubkey && authorization.expiresAt >= Date.now()
  );
}

export async function verifyWalletPin(accountPubkey: string, pin: string): Promise<boolean> {
  if (!PIN_PATTERN.test(pin)) return false;
  const value = await platform.secureStorage.getItem(walletPinKey(accountPubkey));
  if (!value) return false;
  let record: PinRecord;
  try {
    record = JSON.parse(value) as PinRecord;
    if (record.version !== 1 || !record.salt || !record.digest) return false;
  } catch {
    return false;
  }
  const expected = hexToBytes(record.digest);
  const actual = await scryptAsync(pin, record.salt, SCRYPT_OPTIONS);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index++) difference |= actual[index] ^ expected[index];
  return difference === 0;
}

export function removeWalletPin(accountPubkey: string): Promise<void> {
  return platform.secureStorage.deleteItem(walletPinKey(accountPubkey));
}
