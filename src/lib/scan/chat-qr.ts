import { parseNostrInput } from '@/lib/nostr/keys';
import { parseNostrEventReference } from '@/lib/nostr/event-reference';
import { normalizeNip05Identifier, queryNip05Profile } from '@/lib/nostr/nip05';
import { parseNwcConnectionString } from '@/lib/wallet/nwc';
import { parseBolt11Invoice } from '@/services/wallet/bolt11';
import { isLikelyLnurlPayTarget, normalizeLightningInput } from '@/services/wallet/lnurl';

export type ChatQrScanResult =
  | { kind: 'chat'; pubkey: string }
  | { kind: 'payment'; input: string }
  | { kind: 'wallet'; connectionString: string }
  | { kind: 'napplet'; address: string }
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

  if (raw.length <= 8192) {
    const code = raw.match(/(?:naddr|nevent|note)1[023456789acdefghjklmnpqrstuvwxyz]+/i)?.[0];
    const reference = code ? parseNostrEventReference(code) : null;
    if (reference && (reference.kind === undefined || [15129, 35129].includes(reference.kind))) {
      return { kind: 'napplet', address: reference.bech32 };
    }
  }

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
