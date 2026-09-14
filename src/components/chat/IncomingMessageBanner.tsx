import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/common/Avatar';
import { AppText } from '@/components/common/AppText';
import { InteractionOverlay } from '@/components/common/InteractionOverlay';
import { InteractivePressable } from '@/components/common/InteractivePressable';
import { MessagePreviewText } from '@/components/chat/MessagePreviewText';
import {
  conversationMessageBaseline,
  findIncomingConversation,
} from '@/components/chat/incoming-message-banner-state';
import {
  useMainInboxConversations,
  useRequestConversations,
  type ConversationWithLast,
} from '@/hooks/use-conversations';
import { useDisplayName } from '@/hooks/use-display-name';
import { attachmentLabel } from '@/lib/nostr/attachment-label';
import {
  contentWidth,
  headerHeight,
  radius,
  shadow,
  spacing,
  uiDensity,
  useThemeColors,
} from '@/theme';
import { useTranslation } from 'react-i18next';

const VISIBLE_MS = 4000;

type Props = {
  accountPubkey: string;
  activeConversationKey: string;
};

export function IncomingMessageBanner({ accountPubkey, activeConversationKey }: Props) {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { conversations: inbox, loaded: inboxLoaded } =
    useMainInboxConversations(accountPubkey);
  const { conversations: requests, loaded: requestsLoaded } =
    useRequestConversations(accountPubkey);
  const items = useMemo(() => [...inbox, ...requests], [inbox, requests]);
  const baselineRef = useRef<ReturnType<typeof conversationMessageBaseline> | null>(null);
  const [visibleItem, setVisibleItem] = useState<ConversationWithLast | null>(null);

  useEffect(() => {
    if (!inboxLoaded || !requestsLoaded) return;
    const nextBaseline = conversationMessageBaseline(items);
    const previous = baselineRef.current;
    baselineRef.current = nextBaseline;
    if (!previous) return;

    const incoming = findIncomingConversation(
      previous,
      items,
      accountPubkey,
      activeConversationKey,
    );
    if (incoming) setVisibleItem(incoming);
  }, [accountPubkey, activeConversationKey, inboxLoaded, items, requestsLoaded]);

  const visibleMessageId = visibleItem?.conversation.lastMessageId;
  useEffect(() => {
    if (!visibleMessageId) return;
    const timer = setTimeout(() => {
      setVisibleItem((current) =>
        current?.conversation.lastMessageId === visibleMessageId ? null : current,
      );
    }, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [visibleMessageId]);

  if (!visibleItem) return null;

  const conversation = visibleItem.conversation;
  return (
    <IncomingMessageBannerContent
      item={visibleItem}
      top={insets.top + headerHeight + spacing.sm}
      onPress={() => {
        setVisibleItem(null);
        const href =
          conversation.deliveryKind === 'proximity'
            ? `/chat/${encodeURIComponent(conversation.conversationKey)}?transport=proximity&name=${encodeURIComponent(conversation.name ?? '')}`
            : `/chat/${encodeURIComponent(conversation.conversationKey)}`;
        router.replace(href);
      }}
      colors={c}
      attachmentLabels={{
        file: t('conversations.attachment_file_preview'),
        image: t('conversations.attachment_image_preview'),
        video: t('conversations.attachment_video_preview'),
        voice: t('conversations.attachment_voice_preview'),
      }}
    />
  );
}

function IncomingMessageBannerContent({
  item,
  top,
  onPress,
  colors,
  attachmentLabels,
}: {
  item: ConversationWithLast;
  top: number;
  onPress: () => void;
  colors: ReturnType<typeof useThemeColors>;
  attachmentLabels: Parameters<typeof attachmentLabel>[1];
}) {
  const conversation = item.conversation;
  const { name: resolvedName, profile } = useDisplayName(
    conversation.conversationKey,
    conversation.deliveryKind === 'relay',
  );
  const displayName = conversation.name || resolvedName;
  const preview =
    item.lastMessageKind === 15
      ? attachmentLabel(item.lastMessageTags, attachmentLabels)
      : (item.lastMessageContent ?? '');

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top,
        start: 0,
        end: 0,
        zIndex: 100,
        alignItems: 'center',
        paddingHorizontal: spacing.lg,
      }}
    >
      <InteractivePressable
        accessibilityRole="button"
        accessibilityLabel={`${displayName}: ${preview}`}
        fallbackHoverOpacity={false}
        onPress={onPress}
        style={{
          width: '100%',
          maxWidth: contentWidth.toast,
          borderRadius: radius.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          backgroundColor: colors.surfaceElevated,
          ...shadow.float,
        }}
      >
        {({ pressed }) => (
          <View
            style={{
              minWidth: 0,
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
            }}
          >
            {pressed ? <InteractionOverlay borderRadius={radius.lg} /> : null}
            <Avatar
              pubkey={conversation.conversationKey}
              picture={conversation.deliveryKind === 'relay' ? profile?.picture : null}
              size={uiDensity.inAppNotificationAvatarSize}
            />
            <View style={{ minWidth: 0, flex: 1, flexDirection: 'row', alignItems: 'baseline' }}>
              <AppText
                variant="body"
                weight="semibold"
                numberOfLines={1}
                style={{ maxWidth: '40%', flexShrink: 1 }}
              >
                {displayName}
              </AppText>
              <View style={{ width: spacing.sm }} />
              <MessagePreviewText content={preview} tags={item.lastMessageTags} />
            </View>
          </View>
        )}
      </InteractivePressable>
    </View>
  );
}
