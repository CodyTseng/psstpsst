import { memo, useCallback } from 'react';
import { FlatList, StyleSheet, View, type ScrollViewProps } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';
import Reanimated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { AppText } from '@/components/common/AppText';
import { Avatar } from '@/components/common/Avatar';
import { NearbyBadge } from '@/components/common/NearbyBadge';
import { SelectionDot } from '@/components/common/SelectionDot';
import { SelfBadge } from '@/components/common/SelfBadge';
import type { ConversationWithLast } from '@/hooks/use-conversations';
import { useContact } from '@/hooks/use-contacts';
import { useProfile } from '@/hooks/use-profile';
import { useIsRTL } from '@/i18n/direction';
import { resolveDisplayName } from '@/lib/nostr/display-name';
import { shareTargetId, type ShareTarget } from '@/lib/share/share-target';
import { useActiveAccount } from '@/stores/active-account.store';
import { spacing, uiDensity, useThemeColors } from '@/theme';

const SELECT_COL = 34;

type RowProps = {
  item: ConversationWithLast;
  selected?: boolean;
  selectProgress?: SharedValue<number>;
  onSelect: (target: ShareTarget) => void;
};

export const ConversationRecipientRow = memo(function ConversationRecipientRow({
  item,
  selected,
  selectProgress,
  onSelect,
}: RowProps) {
  const c = useThemeColors();
  const isRTL = useIsRTL();
  const accountPubkey = useActiveAccount((state) => state.activePubkey) ?? '';
  const conversation = item.conversation;
  const relayPubkey = conversation.deliveryKind === 'relay' ? conversation.conversationKey : null;
  const isSelf = relayPubkey === accountPubkey;
  const profile = useProfile(relayPubkey);
  const contact = useContact(accountPubkey, relayPubkey ?? '');
  const displayName =
    conversation.name ||
    resolveDisplayName(conversation.conversationKey, {
      petname: contact?.petname,
      displayName: profile?.displayName,
      name: profile?.name,
    });
  const contentShift = useAnimatedStyle(() => ({
    marginEnd: (selectProgress?.value ?? 0) * SELECT_COL,
    transform: [{ translateX: (selectProgress?.value ?? 0) * SELECT_COL * (isRTL ? -1 : 1) }],
  }));
  const dotFade = useAnimatedStyle(() => ({ opacity: selectProgress?.value ?? 0 }));

  return (
    <Pressable
      pressFeedback="delayed"
      onPress={() =>
        onSelect({
          conversationKey: conversation.conversationKey,
          deliveryKind: conversation.deliveryKind,
          name: displayName,
        })
      }
      style={({ pressed }) => ({
        height: uiDensity.contactRowHeight,
        paddingHorizontal: 16,
        justifyContent: 'center',
        overflow: 'hidden',
        backgroundColor: pressed ? c.interactionOverlay : c.background,
      })}
    >
      {selected !== undefined ? (
        <Reanimated.View
          style={[
            { position: 'absolute', start: 16, top: 0, bottom: 0, justifyContent: 'center' },
            dotFade,
            { pointerEvents: 'none' },
          ]}
        >
          <SelectionDot selected={selected} />
        </Reanimated.View>
      ) : null}
      <Reanimated.View
        style={[{ flexDirection: 'row', alignItems: 'center', gap: 12 }, contentShift]}
      >
        <Avatar
          pubkey={conversation.conversationKey}
          picture={conversation.deliveryKind === 'relay' ? profile?.picture : null}
          name={displayName}
          size={uiDensity.contactAvatarSize}
        />
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {isSelf ? <SelfBadge /> : null}
          {conversation.deliveryKind === 'proximity' ? <NearbyBadge /> : null}
          <AppText variant="subtitle" numberOfLines={1} style={{ flexShrink: 1 }}>
            {displayName}
          </AppText>
        </View>
      </Reanimated.View>
    </Pressable>
  );
});

export function ConversationRecipientList({
  items,
  selectedIds,
  selectProgress,
  header,
  onSelect,
  onScroll,
  scrollEventThrottle,
}: {
  items: ConversationWithLast[];
  selectedIds?: Set<string>;
  selectProgress?: SharedValue<number>;
  header?: React.ReactElement | null;
  onSelect: (target: ShareTarget) => void;
  onScroll?: ScrollViewProps['onScroll'];
  scrollEventThrottle?: number;
}) {
  const c = useThemeColors();
  const renderItem = useCallback(
    ({ item }: { item: ConversationWithLast }) => {
      const id = shareTargetId(item.conversation);
      return (
        <ConversationRecipientRow
          item={item}
          selected={selectedIds ? selectedIds.has(id) : undefined}
          selectProgress={selectProgress}
          onSelect={onSelect}
        />
      );
    },
    [onSelect, selectProgress, selectedIds],
  );

  return (
    <FlatList
      onScroll={onScroll}
      scrollEventThrottle={scrollEventThrottle}
      data={items}
      renderItem={renderItem}
      keyExtractor={(item) => shareTargetId(item.conversation)}
      ListHeaderComponent={header}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: spacing.lg }}
      ItemSeparatorComponent={() => (
        <View
          style={{
            height: StyleSheet.hairlineWidth,
            marginStart: spacing.lg + uiDensity.contactAvatarSize + spacing.md,
            backgroundColor: c.border,
          }}
        />
      )}
    />
  );
}
