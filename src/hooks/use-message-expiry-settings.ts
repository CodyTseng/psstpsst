import { useMemo } from 'react';

import { useLiveQuery } from '@/db/use-live-query';
import { messageExpirySettingsQuery, readExpirySettings } from '@/services/conversation/message-expiry-preference';

export function useMessageExpirySettings(accountPubkey: string) {
  const { data, isResolved } = useLiveQuery(messageExpirySettingsQuery(accountPubkey), [accountPubkey]);
  const state = data?.[0]?.accountPubkey === accountPubkey ? data[0] : undefined;
  const values = useMemo(() => readExpirySettings(state), [state]);
  return { values, loaded: isResolved };
}
