import { useMemo } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatHeader } from '@/components/chat/ChatHeader';
import { ChatFileDropZone } from '@/components/chat/ChatFileDropZone';
import { ChatInput } from '@/components/chat/ChatInput';
import { MessageList } from '@/components/chat/MessageList';
import {
  ChatComposerPanelDismissOverlay,
  ChatComposerPanelProvider,
} from '@/components/chat/chat-composer-panel-context';
import { AppScreen } from '@/components/common/AppScreen';
import type { messages as messagesSchema } from '@/db/schema';
import type { Rumor } from '@/db/schema/types';
import { conversationAttachmentSources } from '@/lib/conversation/capabilities';
import { getBottomChromeInset } from '@/lib/layout/bottom-chrome';
import { useActiveAccount } from '@/stores/active-account.store';
import { useScreenshotPreviewStore } from '@/stores/screenshot-preview.store';
import { bottomBarHeight, headerHeight } from '@/theme';

import {
  getScreenshotConversation,
  SCREENSHOT_UNREAD_COUNT,
  type ScreenshotConversation,
} from './screenshot-preview-data';

type MessageRow = typeof messagesSchema.$inferSelect;

const ATTACHMENT_SOURCES = conversationAttachmentSources(false);
const EMPTY_OBJECT = {};
const EMPTY_ARRAY: never[] = [];
const NOOP = () => {};

function clockMinutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function buildMessages(
  accountPubkey: string,
  conversation: ScreenshotConversation,
): MessageRow[] {
  const newest = conversation.messages[conversation.messages.length - 1];
  const newestClockMinutes = clockMinutes(newest.time);
  return conversation.messages.map((message, index) => {
    const createdAt =
      conversation.lastMessageAt - (newestClockMinutes - clockMinutes(message.time)) * 60;
    const senderPubkey = message.own ? accountPubkey : conversation.pubkey;
    const id = `${conversation.id}:${message.id}`;
    const rumor: Rumor = {
      id,
      pubkey: senderPubkey,
      created_at: createdAt,
      kind: 14,
      tags: [],
      content: message.body,
    };
    return {
      accountPubkey,
      id,
      conversationKey: conversation.pubkey,
      senderPubkey,
      kind: 14,
      content: message.body,
      createdAt,
      orderAt: createdAt * 1000 + index,
      replyToId: null,
      subject: null,
      tags: [],
      rumor,
      sourceRelays: message.own ? null : [],
    };
  });
}

/** The production chat surface driven by in-memory promotional fixture rows. */
export function ScreenshotChat({ previewId }: { previewId: string | undefined }) {
  const accountPubkey = useActiveAccount((state) => state.activePubkey) ?? '';
  const readUnreadCount = useScreenshotPreviewStore((state) => state.readUnreadCount);
  const timelineAnchorMs = useScreenshotPreviewStore((state) => state.timelineAnchorMs);
  const insets = useSafeAreaInsets();
  const conversation = getScreenshotConversation(previewId, timelineAnchorMs);
  const messages = useMemo(
    () => buildMessages(accountPubkey, conversation),
    [accountPubkey, conversation],
  );
  const topInset = headerHeight + insets.top;
  const bottomInset = bottomBarHeight + getBottomChromeInset(insets.bottom);

  return (
    <AppScreen edges={[]}>
      <ChatFileDropZone enabled={false} onDropFiles={NOOP}>
        <ChatComposerPanelProvider>
          <View style={{ flex: 1 }}>
            <View style={{ flex: 1 }}>
              <MessageList
                messages={messages}
                pendingAttachments={EMPTY_ARRAY}
                pendingTailVersion={0}
                pendingFailureVersion={0}
                accountPubkey={accountPubkey}
                conversationKey={conversation.pubkey}
                remoteContentMode="auto"
                reactionsByMessageId={EMPTY_OBJECT}
                presentationsByMessageId={EMPTY_OBJECT}
                bubbleRenderItemsById={EMPTY_OBJECT}
                deliveriesByMessageId={EMPTY_OBJECT}
                referencedById={EMPTY_OBJECT}
                onLoadOlder={NOOP}
                onLoadNewer={NOOP}
                hasMore={false}
                loadingOlder={false}
                loadingNewer={false}
                hasMoreNewer={false}
                oldestBoundary={null}
                tailJumpVersion={0}
                anchored={false}
                windowLoaded
                onFocusAnchor={NOOP}
                onJumpToTail={NOOP}
                onLongPress={NOOP}
                onLongPressPending={NOOP}
                onTapReaction={NOOP}
                onRetryPending={NOOP}
                onStopPending={NOOP}
                onCancelPending={NOOP}
                bottomInset={bottomInset}
                topInset={topInset}
                liveDataEnabled={false}
                interactive={false}
              />
              <ChatComposerPanelDismissOverlay />
            </View>
          </View>
          <ChatInput
            liveDataEnabled={false}
            attachmentSources={ATTACHMENT_SOURCES}
            onSend={NOOP}
            onPickAttachment={NOOP}
            onSendVoice={NOOP}
          />
        </ChatComposerPanelProvider>
        <ChatHeader
        counterpartyPubkey={conversation.pubkey}
        fallbackName={conversation.name}
        pictureOverride={conversation.picture}
          liveDataEnabled={false}
          otherUnreadOverride={Math.max(0, SCREENSHOT_UNREAD_COUNT - readUnreadCount)}
        />
      </ChatFileDropZone>
    </AppScreen>
  );
}
