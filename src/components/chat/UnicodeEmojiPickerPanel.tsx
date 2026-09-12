import { memo, useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  type ListRenderItemInfo,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/common/AppText';
import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';
import { useLanguageDirection } from '@/i18n/direction';
import { EMOJI_GROUPS, type EmojiItem } from '@/lib/emoji/data';
import {
  emojiPickerLayout,
  emojiSize,
  radius,
  spacing,
  useThemeColors,
} from '@/theme';

import { EmojiPickerTabs } from './emoji-picker-tabs';

type Props = {
  bottomInset: number;
  onSelect: (emoji: string) => void;
  width: number;
};

type Row =
  | { type: 'header'; slug: string }
  | { type: 'row'; slug: string; emojis: EmojiItem[] };

type PreparedRows = {
  items: Row[];
  headerIndexByGroup: Record<string, number>;
  stickyHeaderIndices: number[];
  layout: number[];
};

const HORIZONTAL_PADDING = emojiPickerLayout.horizontalGutter;
const CELL_SIZE = 44;
const HEADER_HEIGHT = 32;
const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 0 };
const preparedRowsByColumns = new Map<number, PreparedRows>();
const ignorePackSelection = () => {};

function prepareRows(columns: number): PreparedRows {
  const cached = preparedRowsByColumns.get(columns);
  if (cached) return cached;

  const items: Row[] = [];
  const headerIndexByGroup: Record<string, number> = {};
  const stickyHeaderIndices: number[] = [];
  const layout: number[] = [];
  let offset = 0;

  for (const group of EMOJI_GROUPS) {
    headerIndexByGroup[group.slug] = items.length;
    stickyHeaderIndices.push(items.length);
    layout.push(offset);
    items.push({ type: 'header', slug: group.slug });
    offset += HEADER_HEIGHT;

    for (let index = 0; index < group.emojis.length; index += columns) {
      layout.push(offset);
      items.push({
        type: 'row',
        slug: group.slug,
        emojis: group.emojis.slice(index, index + columns),
      });
      offset += CELL_SIZE;
    }
  }

  const prepared = { items, headerIndexByGroup, stickyHeaderIndices, layout };
  preparedRowsByColumns.set(columns, prepared);
  return prepared;
}

const UnicodeEmojiRow = memo(function UnicodeEmojiRow({
  columns,
  color,
  direction,
  emojis,
  interactionOverlay,
  onSelect,
}: {
  columns: number;
  color: string;
  direction: 'ltr' | 'rtl';
  emojis: EmojiItem[];
  interactionOverlay: string;
  onSelect: (emoji: string) => void;
}) {
  return (
    <View
      style={{
        direction,
        flexDirection: 'row',
        justifyContent: 'space-between',
        height: CELL_SIZE,
        paddingHorizontal: HORIZONTAL_PADDING,
      }}
    >
      {Array.from({ length: columns }, (_, index) => {
        const item = emojis[index];
        if (!item) return <View key={`empty-${index}`} style={{ width: CELL_SIZE }} />;

        return (
          <Pressable
            key={item.slug}
            accessibilityRole="button"
            accessibilityLabel={item.emoji}
            onPress={() => onSelect(item.emoji)}
            style={({ pressed }) => ({
              width: CELL_SIZE,
              height: CELL_SIZE,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.md,
              backgroundColor: pressed ? interactionOverlay : 'transparent',
            })}
          >
            <Text style={[emojiSize.grid, { color }]}>{item.emoji}</Text>
          </Pressable>
        );
      })}
    </View>
  );
});

/** Unicode emoji browser for the composer's keyboard-height inline panel. */
export const UnicodeEmojiPickerPanel = memo(function UnicodeEmojiPickerPanel({
  bottomInset,
  onSelect,
  width,
}: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const direction = useLanguageDirection();
  const columns = Math.max(
    6,
    Math.floor((width - HORIZONTAL_PADDING * 2) / CELL_SIZE),
  );
  const { items, headerIndexByGroup, stickyHeaderIndices, layout } = useMemo(
    () => prepareRows(columns),
    [columns],
  );
  const [activeSlug, setActiveSlug] = useState(EMOJI_GROUPS[0].slug);
  const listRef = useRef<FlatList<Row>>(null);
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: { item: Row }[] }) => {
      const top = viewableItems[0]?.item;
      if (top) setActiveSlug(top.slug);
    },
    [],
  );

  function jumpTo(slug: string) {
    setActiveSlug(slug);
    const index = headerIndexByGroup[slug];
    if (index != null) listRef.current?.scrollToIndex({ index, animated: false });
  }

  return (
    <View style={{ flex: 1 }}>
      <EmojiPickerTabs
        activePack={null}
        activeCategory={activeSlug}
        customPacks={[]}
        standaloneCustomEmojis={[]}
        onSelectPack={ignorePackSelection}
        onSelectCategory={jumpTo}
        unicodeGroups={EMOJI_GROUPS}
      />

      <FlatList
        ref={listRef}
        data={items}
        extraData={direction}
        keyExtractor={(item, index) =>
          item.type === 'header' ? `header:${item.slug}` : `row:${item.slug}:${index}`
        }
        renderItem={({ item }: ListRenderItemInfo<Row>) =>
          item.type === 'header' ? (
            <View
              style={{
                height: HEADER_HEIGHT,
                justifyContent: 'center',
                paddingHorizontal: HORIZONTAL_PADDING,
                paddingVertical: spacing.xs,
                backgroundColor: c.background,
              }}
            >
              <AppText variant="caption" weight="semibold" tone="muted">
                {t(`chat.emoji.categories.${item.slug}`)}
              </AppText>
            </View>
          ) : (
            <UnicodeEmojiRow
              columns={columns}
              color={c.text}
              direction={direction}
              emojis={item.emojis}
              interactionOverlay={c.interactionOverlay}
              onSelect={onSelect}
            />
          )
        }
        getItemLayout={(_, index) => ({
          length: items[index]?.type === 'header' ? HEADER_HEIGHT : CELL_SIZE,
          offset: layout[index] ?? 0,
          index,
        })}
        stickyHeaderIndices={stickyHeaderIndices}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={VIEWABILITY_CONFIG}
        onScrollToIndexFailed={() => {}}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: bottomInset }}
        showsVerticalScrollIndicator={false}
        bounces={false}
        removeClippedSubviews
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        updateCellsBatchingPeriod={40}
        windowSize={7}
      />
    </View>
  );
});
