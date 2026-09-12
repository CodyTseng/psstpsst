import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ActionRow } from '@/components/common/ActionRow';
import { AppText } from '@/components/common/AppText';
import { BottomSheet } from '@/components/common/BottomSheet';
import { PairingCodeBlock } from '@/components/keysync/PairingCodeBlock';
import { useProximityIdentity } from '@/hooks/use-proximity';
import { getCachedProximityPubkey } from '@/services/proximity/proximity-identity.service';
import { proximityPairingCode } from '@/services/proximity/proximity-pairing-code';
import { proximityService } from '@/services/proximity/proximity.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { useProximityStore } from '@/stores/proximity.store';
import { showToast } from '@/stores/toast.store';
import { spacing } from '@/theme';

/** Global consent prompt for an authenticated first-chat request from a nearby peer. */
export function NearbyChatRequestSheet() {
  const { t } = useTranslation();
  const accountPubkey = useActiveAccount((state) => state.activePubkey) ?? '';
  const request = useProximityStore((state) => state.incomingChatRequests[0] ?? null);
  const [response, setResponse] = useState<{
    requestId: string;
    accepted: boolean;
  } | null>(null);
  const { identity } = useProximityIdentity(accountPubkey);
  const localPubkey =
    identity?.accountPubkey === accountPubkey
      ? identity.proximityPubkey
      : getCachedProximityPubkey(accountPubkey);
  const pairingCode = useMemo(
    () =>
      localPubkey && request ? proximityPairingCode(localPubkey, request.peerPubkey) : '',
    [localPubkey, request],
  );
  const busy = response != null;
  const responding = response?.requestId === request?.requestId;

  async function respond(accepted: boolean) {
    if (!request || response) return;
    setResponse({ requestId: request.requestId, accepted });
    try {
      const peer = await proximityService.respondToChatRequest(request.requestId, accepted);
      if (accepted && peer) {
        router.push({
          pathname: `/chat/${encodeURIComponent(peer.peerPubkey)}`,
          params: { transport: 'proximity', name: peer.displayName },
        });
      }
    } catch {
      showToast(t('nearby.request_failed'));
    } finally {
      setResponse(null);
    }
  }

  return (
    <BottomSheet
      visible={request != null}
      onClose={() => void respond(false)}
      title={t('nearby.request_title', { name: request?.displayName ?? '' })}
      contentStyle={{ gap: spacing.lg }}
    >
      <PairingCodeBlock label={t('nearby.pairing_code')} code={pairingCode}>
        <AppText variant="body" tone="muted" align="center">
          {t('nearby.pairing_hint')}
        </AppText>
      </PairingCodeBlock>
      <ActionRow
        layout="horizontal"
        dismiss={{
          label: t('nearby.decline_request'),
          disabled: busy,
          loading: responding && response?.accepted === false,
          onPress: () => void respond(false),
        }}
        confirm={{
          label: t('nearby.accept_request'),
          disabled: busy,
          loading: responding && response?.accepted === true,
          onPress: () => void respond(true),
        }}
      />
    </BottomSheet>
  );
}
