import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation, Easing, FadeIn, FadeInUp, ReduceMotion,
  useAnimatedStyle, useReducedMotion, useSharedValue, withSpring,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
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
import { messageArrivalFeedback } from '@/lib/haptics';
import { platform } from '@/platform';
import { noticeDismissal, noticeTiming } from '@/theme/motion';
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
const NOTICE_EASE_OUT = Easing.bezier(...noticeTiming.bezier);
const NOTICE_ENTER = FadeInUp
  .duration(noticeTiming.duration)
  .easing(NOTICE_EASE_OUT)
  .withInitialValues({ opacity: 0, transform: [{ translateY: -spacing.sm }] })
  .reduceMotion(noticeTiming.reduceMotion);
const NOTICE_FADE = FadeIn
  .duration(noticeTiming.duration)
  .easing(NOTICE_EASE_OUT)
  .reduceMotion(ReduceMotion.Never);

type Props = {
  accountPubkey: string;
  activeConversationKey: string | null;
  enabled: boolean;
  onOpen: (href: string) => void;
};

export function IncomingMessageBanner({ accountPubkey, activeConversationKey, enabled, onOpen }: Props) {
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
  const [interacting, setInteracting] = useState(false);
  const dismissMessage = useCallback((messageId: string) => {
    setVisibleItem((current) =>
      current?.conversation.lastMessageId === messageId ? null : current,
    );
  }, []);

  useEffect(() => {
    if (!inboxLoaded || !requestsLoaded) return;
    const nextBaseline = conversationMessageBaseline(items);
    const previous = baselineRef.current;
    baselineRef.current = nextBaseline;
    if (!previous || !enabled) {
      setVisibleItem(null);
      return;
    }

    const incoming = findIncomingConversation(
      previous,
      items,
      accountPubkey,
      activeConversationKey,
    );
    if (incoming) setVisibleItem(incoming);
    else setVisibleItem((current) =>
      current?.conversation.conversationKey === activeConversationKey ? null : current,
    );
  }, [accountPubkey, activeConversationKey, enabled, inboxLoaded, items, requestsLoaded]);

  const visibleMessageId = visibleItem?.conversation.lastMessageId;
  useEffect(() => {
    if (!visibleMessageId || interacting) return;
    const timer = setTimeout(() => {
      setVisibleItem((current) =>
        current?.conversation.lastMessageId === visibleMessageId ? null : current,
      );
    }, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [visibleMessageId, interacting]);

  if (!visibleItem || !enabled ||
    visibleItem.conversation.conversationKey === activeConversationKey) return null;

  const conversation = visibleItem.conversation;
  return (
    <IncomingMessageBannerContent
      item={visibleItem}
      top={insets.top + headerHeight + spacing.sm}
      onDismiss={dismissMessage}
      onInteractionChange={setInteracting}
      onPress={() => {
        setVisibleItem(null);
        const href =
          conversation.deliveryKind === 'proximity'
            ? `/chat/${encodeURIComponent(conversation.conversationKey)}?transport=proximity&name=${encodeURIComponent(conversation.name ?? '')}`
            : `/chat/${encodeURIComponent(conversation.conversationKey)}`;
        onOpen(href);
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
  onDismiss,
  onInteractionChange,
  colors,
  attachmentLabels,
}: {
  item: ConversationWithLast;
  top: number;
  onPress: () => void;
  onDismiss: (messageId: string) => void;
  onInteractionChange: (interacting: boolean) => void;
  colors: ReturnType<typeof useThemeColors>;
  attachmentLabels: Parameters<typeof attachmentLabel>[1];
}) {
  const conversation = item.conversation;
  const reducedMotion = useReducedMotion();
  const translateY = useSharedValue(0);
  const startY = useSharedValue(0);
  const bannerHeight = useSharedValue(uiDensity.inAppNotificationAvatarSize + spacing.sm * 2);
  const dragged = useSharedValue(false);
  const dismissing = useSharedValue(false);
  const messageId = useSharedValue(conversation.lastMessageId ?? '');
  const feedbackSent = useRef(false);

  useEffect(() => {
    if (feedbackSent.current) return;
    feedbackSent.current = true;
    if (!platform.notifications.shouldNotifyNow()) messageArrivalFeedback();
  }, []);

  useEffect(() => {
    messageId.set(conversation.lastMessageId ?? '');
    // A newer arrival must survive an older message's in-flight dismissal.
    if (dismissing.get()) {
      cancelAnimation(translateY);
      translateY.set(0);
      dismissing.set(false);
      onInteractionChange(false);
    }
  }, [conversation.lastMessageId, dismissing, messageId, onInteractionChange, translateY]);

  useEffect(() => () => { onInteractionChange(false); }, [onInteractionChange]);

  const pan = useMemo(() => Gesture.Pan()
    .activeOffsetY([-noticeDismissal.activationDistance, noticeDismissal.activationDistance])
    .failOffsetX([-noticeDismissal.horizontalTolerance, noticeDismissal.horizontalTolerance])
    .onBegin(() => {
      if (dismissing.get()) return;
      cancelAnimation(translateY);
      startY.set(translateY.get());
      dragged.set(false);
      scheduleOnRN(onInteractionChange, true);
    })
    .onStart(() => { dragged.set(true); })
    .onUpdate((event) => {
      if (!dismissing.get()) translateY.set(Math.min(0, startY.get() + event.translationY));
    })
    .onFinalize((event, success) => {
      if (dismissing.get()) return;
      if (success && translateY.get() <= -noticeDismissal.threshold) {
        dismissing.set(true);
        const dismissedId = messageId.get();
        const targetY = Math.min(translateY.get(), -(top + bannerHeight.get() + spacing.lg));
        translateY.set(withSpring(targetY, {
          ...noticeDismissal.exit,
          velocity: Math.min(0, event.velocityY),
        }, (finished) => {
          if (finished) {
            scheduleOnRN(onDismiss, dismissedId);
            scheduleOnRN(onInteractionChange, false);
          }
        }));
      } else {
        translateY.set(withSpring(0, {
          ...noticeDismissal.settle,
          velocity: event.velocityY,
        }, (finished) => {
          if (finished) scheduleOnRN(onInteractionChange, false);
        }));
      }
    }), [bannerHeight, dismissing, dragged, messageId, onDismiss, onInteractionChange, startY, top, translateY]);
  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.get() }] }));
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
    <Animated.View
      entering={reducedMotion ? NOTICE_FADE : NOTICE_ENTER}
      style={{
        position: 'absolute',
        top,
        start: 0,
        end: 0,
        zIndex: 100,
        alignItems: 'center',
        paddingHorizontal: spacing.lg, pointerEvents: 'box-none' }}
    >
      <GestureDetector gesture={pan} touchAction="none">
        <Animated.View
          onLayout={(event) => { bannerHeight.set(event.nativeEvent.layout.height); }}
          style={[{ width: '100%', maxWidth: contentWidth.toast }, dragStyle]}
        >
          <InteractivePressable
            accessibilityRole="button"
            accessibilityLabel={`${displayName}: ${preview}`}
            fallbackHoverOpacity={false}
            onPress={() => {
              if (!dragged.get() && !dismissing.get()) onPress();
            }}
            onAccessibilityEscape={() => { onDismiss(messageId.get()); }}
            style={{
              width: '100%',
              maxWidth: contentWidth.toast,
              borderRadius: radius.lg,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: colors.border,
              backgroundColor: colors.surfaceFloating,
              ...shadow.notice,
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
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}
