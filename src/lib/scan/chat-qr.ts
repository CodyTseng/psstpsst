import { parseNostrInput } from '@/lib/nostr/keys';
import { normalizeNip05Identifier, queryNip05Profile } from '@/lib/nostr/nip05';
import { parseNwcConnectionString } from '@/lib/wallet/nwc';
import { parseBolt11Invoice } from '@/services/wallet/bolt11';
import { isLikelyLnurlPayTarget, normalizeLightningInput } from '@/services/wallet/lnurl';

export type ChatQrScanResult =
  | { kind: 'chat'; pubkey: string }
  | { kind: 'payment'; input: string }
  | { kind: 'wallet'; connectionString: string }
  | { kind: 'invalid' };

export async function resolveChatQrScan(input: string): Promise<ChatQrScanResult> {
  const raw = input.trim();
  if (!raw) return { kind: 'invalid' };

  try {
    parseNwcConnectionString(raw);
    return { kind: 'wallet', connectionString: raw };
  } catch {}

  try {
    return { kind: 'chat', pubkey: parseNostrInput(raw) };
  } catch {}

  const email = extractEmailLikeValue(raw);
  const nip05 = email ? normalizeNip05Identifier(email) : null;
  if (nip05) {
    const profile = await queryNip05Profile(nip05);
    if (profile) return { kind: 'chat', pubkey: profile.pubkey };
    if (isLikelyPaymentTarget(nip05)) return { kind: 'payment', input: nip05 };
    return { kind: 'invalid' };
  }

  if (isLikelyPaymentTarget(raw)) return { kind: 'payment', input: raw };

  return { kind: 'invalid' };
}

function extractEmailLikeValue(input: string): string | null {
  const trimmed = input.trim();
  const withoutMailto = trimmed.replace(/^mailto:/i, '').split('?')[0];
  return withoutMailto.includes('@') ? withoutMailto : null;
}

function isLikelyPaymentTarget(input: string): boolean {
  try {
    parseBolt11Invoice(normalizeLightningInput(input));
    return true;
  } catch {}

  return isLikelyLnurlPayTarget(input);
}
