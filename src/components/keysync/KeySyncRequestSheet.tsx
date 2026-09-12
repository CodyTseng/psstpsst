import type { Event } from 'nostr-tools';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ActionRow } from '@/components/common/ActionRow';
import { AppText } from '@/components/common/AppText';
import { BottomSheet } from '@/components/common/BottomSheet';
import { PairingCodeBlock } from '@/components/keysync/PairingCodeBlock';
import { buildSigner } from '@/services/account/account.service';
import { dmService } from '@/services/dm/dm.service';
import {
  exportKeyForTransfer,
  getClientPubkeyFromEvent,
  getEncryptionPubkeyFromEvent,
  getKeySyncRelayHints,
  getVerificationCode,
} from '@/services/dm/encryption-key.service';
import {
  classifyKeySyncRequest,
  isKeySyncRequestResolvedByTransfer,
} from '@/services/dm/key-sync-session';
import { ownKeyTransferRelays } from '@/services/relay/relay-list.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { spacing } from '@/theme';

/**
 * Global handler mounted in the app shell. Listens for Key Transfer requests
 * (kind 4454) from the user's other devices and prompts the user — after
 * comparing a pairing code — to send their encryption key (kind 4455). Also
 * surfaces encryption-key rotation observed on another device.
 *
 * Uses our declarative BottomSheet (state-driven RN Modal) rather than
 * @gorhom/bottom-sheet: presenting a bottom-sheet imperatively from this
 * layout-level (non-screen) mount point silently no-ops, so a declarative
 * Modal is the reliable choice for this event-driven security prompt.
 * (DESIGN §10 prefers bottom sheets for user-summoned menus; this is a
 * background-triggered confirmation — break noted.)
 */
export function KeySyncRequestSheet() {
  const { t } = useTranslation();
  const activePubkey = useActiveAccount((s) => s.activePubkey);
  const requireResync = useActiveAccount((s) => s.requireResync);
  const pendingRef = useRef<Event | null>(null);
  const resolutionWatchUnsubRef = useRef<(() => void) | null>(null);
  const [pending, setPending] = useState<Event | null>(null);
  const [sendingRequestId, setSendingRequestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribeRequest = dmService.onSyncRequest((event) => {
      const current = pendingRef.current;
      if (current) {
        const disposition = classifyKeySyncRequest(current, event);
        // A retry signs a fresh 4454 id but keeps the same client key for this
        // visible exchange. The open approval already covers it, so persist the
        // duplicate id now rather than replaying a stale prompt next launch.
        if (disposition === 'duplicate') {
          // A retry may include newer return-relay hints. Refresh the narrow
          // watcher without disturbing the visible approval.
          resolutionWatchUnsubRef.current?.();
          resolutionWatchUnsubRef.current = dmService.watchSyncRequestResolution(event);
          void dmService.markSyncRequestProcessed(event.id);
          return;
        }
        // A different client key is a NEW mounted requester session (reload,
        // restart, or a second requesting device). Replace the stale approval;
        // sending to its old ephemeral key could succeed at the relay while the
        // visible requester waits forever because nobody holds that privkey now.
        void dmService.markSyncRequestProcessed(current.id);
      }
      resolutionWatchUnsubRef.current?.();
      resolutionWatchUnsubRef.current = dmService.watchSyncRequestResolution(event);
      pendingRef.current = event;
      setError(null);
      setPending(event);
    });
    const unsubscribeTransfer = dmService.onKeyTransfer((transfer) => {
      const current = pendingRef.current;
      if (!current || !isKeySyncRequestResolvedByTransfer(current, transfer)) return;
      // A different existing device has already answered this exact client-key
      // request. The requester can receive only one key, so withdraw our
      // redundant confirmation instead of leaving a stale security prompt open.
      void dmService.markSyncRequestProcessed(current.id);
      resolutionWatchUnsubRef.current?.();
      resolutionWatchUnsubRef.current = null;
      pendingRef.current = null;
      setError(null);
      setPending(null);
    });
    return () => {
      unsubscribeRequest();
      unsubscribeTransfer();
      resolutionWatchUnsubRef.current?.();
      resolutionWatchUnsubRef.current = null;
    };
  }, []);

  useEffect(() => {
    // A rotation makes our local key stale: messages would be signed/encrypted
    // with the wrong key. Force re-sync immediately — no cancel — which drops
    // into the full-screen need_sync gate that blocks chatting until a valid
    // key arrives.
    const unsub = dmService.onEncryptionKeyChanged((newPubkey) => {
      void requireResync(newPubkey);
    });
    return unsub;
  }, [requireResync]);

  const recipientClientPubkey = pending ? getClientPubkeyFromEvent(pending) : null;
  const code = recipientClientPubkey ? getVerificationCode(recipientClientPubkey) : '';
  const sending = pending?.id === sendingRequestId;

  function close() {
    const ev = pendingRef.current;
    if (ev) void dmService.markSyncRequestProcessed(ev.id);
    resolutionWatchUnsubRef.current?.();
    resolutionWatchUnsubRef.current = null;
    pendingRef.current = null;
    setPending(null);
  }

  async function send() {
    if (!activePubkey || !pending || !recipientClientPubkey || sending) return;
    const request = pending;
    const requestClientPubkey = recipientClientPubkey;
    setSendingRequestId(request.id);
    setError(null);
    try {
      const signer = await buildSigner(activePubkey);
      const keyTransferRelays = await ownKeyTransferRelays(activePubkey);
      const replyRelays = Array.from(
        new Set([...keyTransferRelays, ...getKeySyncRelayHints(request)]),
      );
      // Another device may already have fulfilled this request while the signer
      // or relay list was loading. Never publish a redundant transfer for a
      // request that is no longer the visible exchange.
      if (pendingRef.current?.id !== request.id) return;
      await exportKeyForTransfer({
        signer,
        accountPubkey: activePubkey,
        recipientClientPubkey: requestClientPubkey,
        relays: replyRelays,
        requestedEncryptionPubkey: getEncryptionPubkeyFromEvent(request),
      });
      void dmService.markSyncRequestProcessed(request.id);
      // A new session request can arrive while the old transfer is publishing.
      // Never let that old completion dismiss the replacement approval.
      if (pendingRef.current?.id === request.id) {
        resolutionWatchUnsubRef.current?.();
        resolutionWatchUnsubRef.current = null;
        pendingRef.current = null;
        setPending(null);
      }
    } catch {
      if (pendingRef.current?.id === request.id) setError(t('key_sync.send_failed'));
    } finally {
      // Do not let an older request clear the loading state of a replacement.
      setSendingRequestId((currentId) => (currentId === request.id ? null : currentId));
    }
  }

  return (
    <BottomSheet
      visible={!!pending}
      onClose={close}
      title={t('key_sync.request_title')}
      contentStyle={{ gap: spacing.lg }}
    >
      <AppText variant="body" tone="muted">
        {t('key_sync.request_message')}
      </AppText>

      <PairingCodeBlock label={t('key_sync.pairing_code')} code={code} />

      <AppText variant="caption" tone="muted">
        {t('key_sync.request_verify_hint')}
      </AppText>

      {error ? (
        <AppText variant="caption" tone="danger">
          {error}
        </AppText>
      ) : null}

      <ActionRow
        layout="horizontal"
        dismiss={{ label: t('key_sync.dismiss'), onPress: close }}
        confirm={{
          label: t('key_sync.send_key'),
          loading: sending,
          onPress: () => void send(),
        }}
      />
    </BottomSheet>
  );
}
