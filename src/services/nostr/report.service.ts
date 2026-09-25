import { kinds, type Event } from 'nostr-tools';

import { buildSigner } from '@/services/account/account.service';
import { loadAccountWriteRelays } from '@/services/relay/relay-list.service';
import { relayPool } from '@/services/relay/relay-pool';
import type { Signer } from '@/services/signer/signer.interface';

export const PROFILE_REPORT_TYPES = [
  'nudity',
  'malware',
  'profanity',
  'illegal',
  'spam',
  'impersonation',
  'other',
] as const;

export type ProfileReportType = (typeof PROFILE_REPORT_TYPES)[number];

type ReportUserOptions = {
  accountPubkey: string;
  reportedPubkey: string;
  type: ProfileReportType;
  signer?: Signer;
};

function isHexPubkey(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

/**
 * Publish a public NIP-56 profile report to the author's NIP-65 write relays.
 */
export async function reportUser(options: ReportUserOptions): Promise<Event> {
  const accountPubkey = options.accountPubkey.toLowerCase();
  const reportedPubkey = options.reportedPubkey.toLowerCase();
  if (!isHexPubkey(accountPubkey) || !isHexPubkey(reportedPubkey)) {
    throw new Error('A report requires valid public keys.');
  }
  if (accountPubkey === reportedPubkey) {
    throw new Error('An account cannot report itself.');
  }
  if (!PROFILE_REPORT_TYPES.includes(options.type)) {
    throw new Error('Unsupported report type.');
  }

  const [signer, ownRelays] = await Promise.all([
    options.signer ?? buildSigner(accountPubkey),
    loadAccountWriteRelays(accountPubkey),
  ]);

  // A local signer can be CPU-bound. Let the busy state paint before signing.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const event = await signer.signEvent({
    kind: kinds.Reporting,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', reportedPubkey, options.type]],
    content: '',
  });
  if (event.pubkey !== accountPubkey) {
    throw new Error('Report signer does not match the account.');
  }

  const results = await relayPool.publishEvent({
    relays: ownRelays,
    event,
    signer,
  });
  if (!results.some((result) => result.outcome.ok)) {
    throw new Error('No relay accepted the report.');
  }
  return event;
}
