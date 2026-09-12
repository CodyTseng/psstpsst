import { useCustomEmojis } from '@/hooks/use-custom-emojis';
import { useActiveAccount } from '@/stores/active-account.store';

/** Keeps the active account's preferred emoji list warm without blocking boot. */
export function CustomEmojiSync() {
  const accountPubkey = useActiveAccount((state) => state.activePubkey);
  useCustomEmojis(accountPubkey);
  return null;
}
