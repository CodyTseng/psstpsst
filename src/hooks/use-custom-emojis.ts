import { useCallback, useEffect, useSyncExternalStore } from 'react';

import {
  getEmojiCollectionSnapshot,
  loadEmojiCollection,
  subscribeEmojiCollection,
  type EmojiCollection,
} from '@/services/emoji/custom-emoji.service';

const EMPTY: EmojiCollection = { standalone: [], packs: [], loaded: false, version: 0 };

/** Account-scoped custom emoji collection, seeded from the local cache. Remote
 * freshness is owned by `syncPersonalConfigs` (app start / tab focus), which
 * reconciles the kind-10030 list out of the shared replaceable-events cache. */
export function useCustomEmojis(
  accountPubkey: string | null,
  liveDataEnabled = true,
): EmojiCollection {
  const subscribe = useCallback(
    (listener: () => void) =>
      accountPubkey && liveDataEnabled
        ? subscribeEmojiCollection(accountPubkey, listener)
        : () => {},
    [accountPubkey, liveDataEnabled],
  );
  const snapshot = useCallback(
    () => (accountPubkey ? getEmojiCollectionSnapshot(accountPubkey) : EMPTY),
    [accountPubkey],
  );
  const collection = useSyncExternalStore(subscribe, snapshot, snapshot);

  useEffect(() => {
    if (!accountPubkey || !liveDataEnabled) return;
    void loadEmojiCollection(accountPubkey).catch(() => {});
  }, [accountPubkey, liveDataEnabled]);

  return collection;
}
