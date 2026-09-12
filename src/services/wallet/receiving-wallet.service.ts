import { buildSigner } from '@/services/account/account.service';
import { saveProfile } from '@/services/profile/profile.service';
import { loadAccountDmRelays } from '@/services/relay/relay-list.service';

export async function publishReceivingWalletAddress(
  accountPubkey: string,
  address: string,
): Promise<void> {
  const [signer, relays] = await Promise.all([
    buildSigner(accountPubkey),
    loadAccountDmRelays(accountPubkey),
  ]);
  await saveProfile({
    signer,
    accountPubkey,
    metadata: { lud16: address, lud06: '' },
    relays,
  });
}
