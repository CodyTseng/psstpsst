import { useIsFocused } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/common/AppText';
import { BottomSheet } from '@/components/common/BottomSheet';
import { PairingCodeBlock } from '@/components/keysync/PairingCodeBlock';
import { useProximityIdentity } from '@/hooks/use-proximity';
import { getCachedProximityPubkey } from '@/services/proximity/proximity-identity.service';
import { proximityPairingCode } from '@/services/proximity/proximity-pairing-code';
import { useActiveAccount } from '@/stores/active-account.store';
import { useProximityStore } from '@/stores/proximity.store';
import { spacing } from '@/theme';

type Props = {
  peerPubkey: string | null;
  awaitingRequest?: boolean;
  onClose?: () => void;
};

/** Shared waiting sheet for an outgoing Nearby connection request. */
export function NearbyOutgoingRequestSheet({
  peerPubkey,
  awaitingRequest = false,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const focused = useIsFocused();
  const accountPubkey = useActiveAccount((state) => state.activePubkey) ?? '';
  const pending = useProximityStore(
    (state) => !!peerPubkey && state.outgoingChatRequests[peerPubkey] === true,
  );
  const [dismissedPeer, setDismissedPeer] = useState<string | null>(null);
  const { identity } = useProximityIdentity(accountPubkey);
  const localPubkey =
    identity?.accountPubkey === accountPubkey
      ? identity.proximityPubkey
      : getCachedProximityPubkey(accountPubkey);
  const pairingCode = useMemo(
    () =>
      localPubkey && peerPubkey ? proximityPairingCode(localPubkey, peerPubkey) : '',
    [localPubkey, peerPubkey],
  );
  useEffect(
    () =>
      useProximityStore.subscribe((state, previous) => {
        if (
          peerPubkey &&
          previous.outgoingChatRequests[peerPubkey] &&
          !state.outgoingChatRequests[peerPubkey]
        ) {
          setDismissedPeer(null);
        }
      }),
    [peerPubkey],
  );
  useEffect(() => {
    if (!awaitingRequest) return;
    const timer = setTimeout(() => setDismissedPeer(null), 0);
    return () => clearTimeout(timer);
  }, [awaitingRequest, peerPubkey]);
  return (
    <BottomSheet
      visible={(awaitingRequest || (focused && pending)) && dismissedPeer !== peerPubkey}
      onClose={() => {
        setDismissedPeer(peerPubkey);
        onClose?.();
      }}
      title={t('nearby.waiting_for_acceptance')}
      contentStyle={{ gap: spacing.lg }}
    >
      <PairingCodeBlock label={t('nearby.pairing_code')} code={pairingCode}>
        <AppText variant="body" tone="muted" align="center">
          {t('nearby.pairing_hint')}
        </AppText>
      </PairingCodeBlock>
    </BottomSheet>
  );
}
