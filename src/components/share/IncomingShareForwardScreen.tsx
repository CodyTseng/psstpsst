import { useIncomingShare } from 'expo-sharing';
import { router, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { IncomingSharePreview } from '@/components/share/IncomingSharePreview';
import { ForwardRecipientScreen } from '@/components/share/ForwardRecipientScreen';
import {
  conversationSupportsIncomingShareItem,
  type ConversationDeliveryKind,
} from '@/lib/conversation/capabilities';
import {
  MAX_INCOMING_SHARE_ITEMS,
  normalizeIncomingShare,
  type IncomingShareItem,
} from '@/lib/share/incoming-share';
import type { ShareTarget } from '@/lib/share/share-target';
import { platform } from '@/platform';
import { buildSigner } from '@/services/account/account.service';
import { conversationSendService } from '@/services/conversation/conversation-send.service';
import { nextRumorTimestamp } from '@/services/dm/rumor-clock';
import { stageIncomingShare } from '@/services/files/incoming-share-file.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { showToast } from '@/stores/toast.store';

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function sendIncomingShare(
  accountPubkey: string,
  targets: ShareTarget[],
  items: IncomingShareItem[],
): Promise<boolean> {
  let failed = false;
  let signer: Awaited<ReturnType<typeof buildSigner>> | null = null;

  for (const item of items) {
    if (item.kind === 'text') {
      for (const target of targets) {
        try {
          await conversationSendService.sendMessage({
            accountPubkey,
            target,
            content: item.content,
            timestamp: nextRumorTimestamp(),
          });
        } catch {
          failed = true;
        }
        await yieldToUi();
      }
      continue;
    }

    try {
      signer ??= await buildSigner(accountPubkey);
      await conversationSendService.sendFile({
        accountPubkey,
        signer,
        targets,
        localUri: item.localUri,
        mime: item.mime,
        name: item.name,
      });
    } catch {
      failed = true;
    }
    await yieldToUi();
  }

  return failed;
}

/** Handles the OS payload while presenting the common `/forward` recipient UI. */
export function IncomingShareForwardScreen() {
  const { t } = useTranslation();
  const accountPubkey = useActiveAccount((state) => state.activePubkey) ?? '';
  const navigation = useNavigation();
  const alertShown = useRef(false);
  const [sending, setSending] = useState(false);
  const { sharedPayloads, resolvedSharedPayloads, isResolving, clearSharedPayloads } =
    useIncomingShare();
  const items = useMemo(
    () => normalizeIncomingShare(sharedPayloads, resolvedSharedPayloads),
    [resolvedSharedPayloads, sharedPayloads],
  );
  const supportedDeliveryKinds = useMemo<ReadonlySet<ConversationDeliveryKind>>(
    () =>
      items.length > 0 && items.every((item) => conversationSupportsIncomingShareItem(item))
        ? new Set(['relay', 'proximity'])
        : new Set(),
    [items],
  );

  const clearIncomingShare = useCallback(() => {
    try {
      clearSharedPayloads();
    } catch {
      // A stale development binary may not have the native share target yet.
    }
  }, [clearSharedPayloads]);

  const leaveForward = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);

  useEffect(() => navigation.addListener('beforeRemove', clearIncomingShare), [
    clearIncomingShare,
    navigation,
  ]);

  useEffect(() => {
    if (isResolving || alertShown.current) return;
    const tooMany = sharedPayloads.length > MAX_INCOMING_SHARE_ITEMS;
    if (sharedPayloads.length > 0 && !tooMany) return;
    alertShown.current = true;
    void platform.confirmationDialog
      .notify({
        title: t('share.receive_failed_title'),
        message: tooMany ? t('share.too_many_items') : t('share.receive_failed'),
        okLabel: t('common.close'),
      })
      .then(() => {
        clearIncomingShare();
        leaveForward();
      });
  }, [clearIncomingShare, isResolving, leaveForward, sharedPayloads.length, t]);

  const send = useCallback(
    (targets: ShareTarget[]) => {
      if (sending || !accountPubkey || items.length === 0 || targets.length === 0) return;
      setSending(true);

      void (async () => {
        try {
          // The native share payload owns these URIs. Copy them before clearing
          // it or navigating away so uploads never depend on an expiring grant.
          const staged = await stageIncomingShare(items);
          clearIncomingShare();
          showToast(t('share.sending'));
          leaveForward();

          setTimeout(() => {
            void sendIncomingShare(accountPubkey, targets, staged.items)
              .then((failed) => {
                if (failed) showToast(t('share.send_failed'));
              })
              .finally(staged.cleanup);
          }, 0);
        } catch {
          setSending(false);
          void platform.confirmationDialog.notify({
            title: t('share.receive_failed_title'),
            message: t('share.stage_failed'),
            okLabel: t('common.ok'),
          });
        }
      })();
    },
    [accountPubkey, clearIncomingShare, items, leaveForward, sending, t],
  );

  return (
    <ForwardRecipientScreen
      accountPubkey={accountPubkey}
      title={t('share.title')}
      preview={<IncomingSharePreview items={items} />}
      supportedDeliveryKinds={supportedDeliveryKinds}
      sending={sending}
      onConfirm={send}
    />
  );
}
