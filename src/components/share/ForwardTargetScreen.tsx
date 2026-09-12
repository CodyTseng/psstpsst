import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppScreen } from '@/components/common/AppScreen';
import { ScreenHeader } from '@/components/common/ScreenHeader';
import { ForwardPreview } from '@/components/share/ForwardPreview';
import { ForwardRecipientScreen } from '@/components/share/ForwardRecipientScreen';
import type { ConversationDeliveryKind } from '@/lib/conversation/capabilities';
import { conversationSupportsMessage } from '@/lib/conversation/capabilities';
import { forwardableTags } from '@/lib/nostr/tags';
import type { ShareTarget } from '@/lib/share/share-target';
import { conversationSendService } from '@/services/conversation/conversation-send.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { useForwardDraftStore } from '@/stores/forward-draft.store';
import { showToast } from '@/stores/toast.store';

/** Full-page recipient picker for message drafts handed to `/forward`. */
export function ForwardTargetScreen() {
  const { t } = useTranslation();
  const accountPubkey = useActiveAccount((state) => state.activePubkey) ?? '';
  const draft = useForwardDraftStore((state) => state.draft);
  const complete = useForwardDraftStore((state) => state.complete);
  const discard = useForwardDraftStore((state) => state.discard);
  const [sending, setSending] = useState(false);
  const completedRef = useRef(false);

  const validDraft = draft?.accountPubkey === accountPubkey ? draft : null;
  const supportedDeliveryKinds = useMemo<ReadonlySet<ConversationDeliveryKind>>(() => {
    if (!validDraft?.messages.every((message) => conversationSupportsMessage(message))) {
      return new Set();
    }
    return new Set(['relay', 'proximity']);
  }, [validDraft]);

  const leaveForward = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);

  useEffect(() => {
    if (validDraft || completedRef.current) return;
    if (draft) discard(draft.id);
    const timer = setTimeout(leaveForward, 0);
    return () => clearTimeout(timer);
  }, [discard, draft, leaveForward, validDraft]);

  useEffect(() => {
    const id = validDraft?.id;
    if (!id) return;
    return () => {
      if (!completedRef.current) discard(id);
    };
  }, [discard, validDraft?.id]);

  const send = useCallback(
    (targets: ShareTarget[]) => {
      if (sending || !validDraft || targets.length === 0) return;
      setSending(true);
      completedRef.current = true;
      const messages = validDraft.messages;
      const account = validDraft.accountPubkey;

      complete(validDraft.id);
      showToast(t('share.sending'));
      leaveForward();

      // Let the route pop and its source paint before synchronous SQLite and
      // crypto work begins. Yield between each message for longer forwards.
      setTimeout(() => {
        void (async () => {
          let failureShown = false;
          for (const target of targets) {
            for (const message of messages) {
              try {
                await conversationSendService.forwardMessage({
                  accountPubkey: account,
                  target,
                  kind: message.kind,
                  content: message.content,
                  contentTags: forwardableTags(message.tags),
                });
              } catch {
                if (!failureShown) {
                  failureShown = true;
                  showToast(t('share.send_failed'));
                }
              }
              await new Promise<void>((resolve) => setTimeout(resolve, 0));
            }
          }
        })();
      }, 0);
    },
    [complete, leaveForward, sending, t, validDraft],
  );

  if (!validDraft) {
    return (
      <AppScreen edges={[]}>
        <ScreenHeader title={t('chat.actions.forward')} />
      </AppScreen>
    );
  }

  return (
    <ForwardRecipientScreen
      accountPubkey={accountPubkey}
      title={t('chat.actions.forward')}
      preview={<ForwardPreview messages={validDraft.messages} />}
      supportedDeliveryKinds={supportedDeliveryKinds}
      excludedRelayPubkey={validDraft.excludedRelayPubkey}
      sending={sending}
      onConfirm={send}
    />
  );
}
