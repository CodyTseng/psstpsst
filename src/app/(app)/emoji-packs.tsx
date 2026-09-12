/* eslint-disable react-hooks/immutability -- Reanimated SharedValue updates are intentional in UI-thread gesture worklets. */
import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, type AccessibilityActionEvent, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { AppButton } from '@/components/common/AppButton';
import { AppScreen } from '@/components/common/AppScreen';
import { IconButton } from '@/components/common/IconButton';
import Plus from 'lucide-react-native/icons/plus';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import {
  EmojiPackListRow,
  EmojiPackRowSkeleton,
  PersonalEmojiCollectionListRow,
} from '@/components/emoji/EmojiPackCard';
import { useCustomEmojis } from '@/hooks/use-custom-emojis';
import { useScrolled } from '@/hooks/use-scrolled';
import { selectionTick } from '@/lib/haptics';
import type { EmojiPack } from '@/lib/nostr/custom-emoji';
import { platform } from '@/platform';
import {
  addEmojiPack,
  removeEmojiPack,
  reorderEmojiPacks,
} from '@/services/emoji/custom-emoji.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing, uiDensity, useThemeColors } from '@/theme';

type SessionPackPosition = {
  accountPubkey: string;
  pack: EmojiPack;
  index: number;
};

type PackSlots = Record<string, number>;

const PACK_ROW_HEIGHT = uiDensity.conversationRowHeight;
const PACK_ROW_CONTENT_INSET = spacing.lg + uiDensity.conversationAvatarSize + spacing.md;
const PACK_ROW_STEP = PACK_ROW_HEIGHT + StyleSheet.hairlineWidth;
const DRAG_LONG_PRESS_MS = 180;

function slotsFor(packs: EmojiPack[]): PackSlots {
  return Object.fromEntries(packs.map((pack, index) => [pack.coordinate, index]));
}

function movePackSlot(slots: PackSlots, from: number, to: number): PackSlots {
  'worklet';
  const next: PackSlots = {};
  for (const coordinate in slots) {
    const at = slots[coordinate];
    if (at === from) next[coordinate] = to;
    else if (from < to && at > from && at <= to) next[coordinate] = at - 1;
    else if (from > to && at < from && at >= to) next[coordinate] = at + 1;
    else next[coordinate] = at;
  }
  return next;
}

function openPack(coordinate: string) {
  router.push({ pathname: '/emoji-pack/[coordinate]', params: { coordinate } });
}

function openPersonalCollection() {
  router.push('/personal-emojis');
}

export default function EmojiPacksScreen() {
  const { t } = useTranslation();
  const c = useThemeColors();
  const titleClearance = useScreenHeaderClearance();
  const accountPubkey = useActiveAccount((state) => state.activePubkey);
  const collection = useCustomEmojis(accountPubkey);
  const { scrolled, scrollProps } = useScrolled();
  const [sessionPackPositions, setSessionPackPositions] = useState<SessionPackPosition[]>([]);
  const [editing, setEditing] = useState(false);
  const [editingPacks, setEditingPacks] = useState<EmojiPack[]>([]);
  const packSlots = useSharedValue<PackSlots>({});

  const minePacks = useMemo(() => {
    const next = [...collection.packs];
    const positioned = sessionPackPositions
      .filter((item) => item.accountPubkey === accountPubkey)
      .sort((left, right) => left.index - right.index);
    for (const item of positioned) {
      const currentIndex = next.findIndex(
        (pack) => pack.coordinate === item.pack.coordinate,
      );
      const pack = currentIndex >= 0
        ? next.splice(currentIndex, 1)[0]
        : item.pack;
      next.splice(Math.min(item.index, next.length), 0, pack);
    }
    return next;
  }, [accountPubkey, collection.packs, sessionPackPositions]);
  const collectedCoordinates = useMemo(
    () => new Set(collection.packs.map((pack) => pack.coordinate)),
    [collection.packs],
  );

  const updateEditing = useCallback((next: boolean) => {
    if (next) {
      const collectedPacks = minePacks.filter((pack) =>
        collectedCoordinates.has(pack.coordinate),
      );
      setEditingPacks(collectedPacks);
      packSlots.value = slotsFor(collectedPacks);
    }
    setEditing(next);
  }, [collectedCoordinates, minePacks, packSlots]);

  const commitPackOrder = useCallback(() => {
    if (!accountPubkey) return;
    const positions = packSlots.value;
    const coordinates = [...editingPacks]
      .sort(
        (left, right) =>
          (positions[left.coordinate] ?? 0) -
          (positions[right.coordinate] ?? 0),
      )
      .map((pack) => pack.coordinate);
    if (
      coordinates.every(
        (coordinate, index) => coordinate === collection.packs[index]?.coordinate,
      )
    ) {
      return;
    }
    void reorderEmojiPacks(accountPubkey, coordinates).catch(() => {
      setEditing(false);
      void platform.confirmationDialog.notify({
        title: t('emoji.save_failed'),
        okLabel: t('common.ok'),
      });
    });
  }, [accountPubkey, collection.packs, editingPacks, packSlots, t]);
  const updatePackCollection = useCallback((
    pack: EmojiPack,
    collected: boolean,
  ) => {
    if (!accountPubkey) return;
    setSessionPackPositions((current) => {
      const withoutPack = current.filter(
        (item) =>
          item.accountPubkey !== accountPubkey ||
          item.pack.coordinate !== pack.coordinate,
      );
      const index = minePacks.findIndex(
        (item) => item.coordinate === pack.coordinate,
      );
      return [...withoutPack, { accountPubkey, pack, index: Math.max(index, 0) }];
    });
    const mutation = collected
      ? removeEmojiPack(accountPubkey, pack.coordinate)
      : addEmojiPack(accountPubkey, pack);
    void mutation.catch(() =>
      platform.confirmationDialog.notify({
        title: t('emoji.save_failed'),
        okLabel: t('common.ok'),
      }),
    );
  }, [accountPubkey, minePacks, t]);

  const togglePackCollection = useCallback((
    pack: EmojiPack,
    collected: boolean,
  ) => {
    if (!collected) {
      void updatePackCollection(pack, false);
      return;
    }

    void platform.confirmationDialog
      .confirm({
        title: t('emoji.remove_pack_title'),
        message: t('emoji.remove_pack_message', {
          name: pack.title || t('emoji.untitled_pack'),
        }),
        cancelLabel: t('common.cancel'),
        confirmLabel: t('emoji.remove_pack_confirm'),
        destructive: true,
      })
      .then((confirmed) => {
        if (confirmed) void updatePackCollection(pack, true);
      });
  }, [t, updatePackCollection]);

  return (
    <AppScreen edges={[]}>
      <FlatList
        data={editing ? editingPacks : minePacks}
        keyExtractor={(pack) => pack.coordinate}
        extraData={editing}
        removeClippedSubviews={!editing}
        contentContainerStyle={{
          paddingTop: titleClearance,
          paddingBottom: spacing['2xl'],
          flexGrow: 1,
        }}
        {...scrollProps}
        ItemSeparatorComponent={() => (
          <View
            style={{
              height: StyleSheet.hairlineWidth,
              marginStart: PACK_ROW_CONTENT_INSET,
              backgroundColor: c.border,
            }}
          />
        )}
        ListHeaderComponent={
          collection.loaded ? (
            <View>
              <PersonalEmojiCollectionListRow
                emojis={collection.standalone}
                onPress={openPersonalCollection}
              />
              {(editing ? editingPacks.length : minePacks.length) > 0 ? (
                <View
                  style={{
                    height: StyleSheet.hairlineWidth,
                    marginStart: PACK_ROW_CONTENT_INSET,
                    backgroundColor: c.border,
                  }}
                />
              ) : null}
            </View>
          ) : null
        }
        renderItem={({ item, index }) => (
          <SortableEmojiPackRow
            pack={item}
            index={index}
            count={editing ? editingPacks.length : minePacks.length}
            slots={packSlots}
            editing={editing}
            collected={
              collection.loaded ? collectedCoordinates.has(item.coordinate) : null
            }
            onCommitOrder={commitPackOrder}
            onOpenPack={openPack}
            onToggleCollection={togglePackCollection}
          />
        )}
        ListEmptyComponent={
          !collection.loaded ? (
            <View>
              <EmojiPackRowSkeleton />
              <View
                style={{
                  height: StyleSheet.hairlineWidth,
                  marginStart: PACK_ROW_CONTENT_INSET,
                  backgroundColor: c.border,
                }}
              />
              <EmojiPackRowSkeleton />
            </View>
          ) : null
        }
      />
      <ScreenHeader
        bordered={scrolled}
        title={t('emoji.packs_title')}
        right={
          editing ? (
            <AppButton
              label={t('common.done')}
              variant="text"
              fullWidth={false}
              onPress={() => updateEditing(false)}
            />
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {collection.loaded && collection.packs.length > 1 ? (
                <View>
                  <AppButton
                    label={t('common.edit')}
                    variant="text"
                    fullWidth={false}
                    onPress={() => updateEditing(true)}
                  />
                </View>
              ) : null}
              <IconButton
                variant="plain"
                size={uiDensity.headerActionSize}
                icon={<Plus strokeWidth={iconStrokeWidth.default} size={uiDensity.headerActionIconSize} color={c.text} />}
                accessibilityLabel={t('emoji.create_pack')}
                onPress={() => router.push('/emoji-pack-editor')}
              />
            </View>
          )
        }
      />
    </AppScreen>
  );
}

type SortableEmojiPackRowProps = {
  pack: EmojiPack;
  index: number;
  count: number;
  slots: SharedValue<PackSlots>;
  editing: boolean;
  collected: boolean | null;
  onCommitOrder: () => void;
  onOpenPack: (coordinate: string) => void;
  onToggleCollection: (pack: EmojiPack, collected: boolean) => void | Promise<void>;
};

function SortableEmojiPackRow({
  pack,
  index,
  count,
  slots,
  editing,
  collected,
  onCommitOrder,
  onOpenPack,
  onToggleCollection,
}: SortableEmojiPackRowProps) {
  const c = useThemeColors();
  const y = useSharedValue(0);
  const startY = useSharedValue(0);
  const dragging = useSharedValue(false);

  useAnimatedReaction(
    () => [slots.value[pack.coordinate] ?? index, index] as const,
    ([slot, baseIndex], previous) => {
      if (dragging.value) return;
      if (baseIndex !== previous?.[1]) {
        // The committed collection now owns the visual order. Clear the old
        // drag offset immediately; springing it to zero would move the row a
        // second time after FlatList has already placed it in its final slot.
        y.value = 0;
      } else if (slot !== previous?.[0]) {
        y.value = withSpring((slot - baseIndex) * PACK_ROW_STEP);
      }
    },
  );

  const moveTo = useCallback((to: number) => {
    const from = slots.value[pack.coordinate];
    const bounded = Math.max(0, Math.min(count - 1, to));
    if (from === bounded) return;
    slots.value = movePackSlot(slots.value, from, bounded);
    selectionTick();
    onCommitOrder();
  }, [count, onCommitOrder, pack.coordinate, slots]);

  const pan = Gesture.Pan()
    .enabled(editing && count > 1)
    .activateAfterLongPress(DRAG_LONG_PRESS_MS)
    .onStart(() => {
      dragging.value = true;
      startY.value = y.value;
    })
    .onUpdate((event) => {
      y.value = startY.value + event.translationY;
      const from = slots.value[pack.coordinate];
      const to = Math.max(
        0,
        Math.min(count - 1, Math.round((index * PACK_ROW_STEP + y.value) / PACK_ROW_STEP)),
      );
      if (to !== from) {
        slots.value = movePackSlot(slots.value, from, to);
        runOnJS(selectionTick)();
      }
    })
    .onFinalize(() => {
      if (!dragging.value) return;
      dragging.value = false;
      y.value = withSpring(
        ((slots.value[pack.coordinate] ?? index) - index) * PACK_ROW_STEP,
      );
      runOnJS(onCommitOrder)();
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: y.value },
      { scale: withSpring(dragging.value ? 1.02 : 1) },
    ],
    zIndex: dragging.value ? 10 : 0,
    backgroundColor: dragging.value ? c.surfaceMuted : c.background,
  }));

  const handleAccessibilityAction = useCallback((event: AccessibilityActionEvent) => {
    const current = slots.value[pack.coordinate] ?? index;
    if (event.nativeEvent.actionName === 'increment') moveTo(current + 1);
    if (event.nativeEvent.actionName === 'decrement') moveTo(current - 1);
  }, [index, moveTo, pack.coordinate, slots]);

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        accessible={editing}
        accessibilityRole={editing ? 'adjustable' : undefined}
        accessibilityLabel={pack.title}
        accessibilityActions={
          editing ? [{ name: 'increment' }, { name: 'decrement' }] : undefined
        }
        onAccessibilityAction={handleAccessibilityAction}
        style={animatedStyle}
      >
        <EmojiPackListRow
          pack={pack}
          collected={collected}
          editing={editing}
          onPress={onOpenPack}
          onToggleCollection={onToggleCollection}
        />
      </Animated.View>
    </GestureDetector>
  );
}
