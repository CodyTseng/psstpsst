import Check from 'lucide-react-native/icons/check';
import {
  memo,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  FlatList,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';

import { AppText } from '@/components/common/AppText';
import Plus from 'lucide-react-native/icons/plus';
import { useLanguageDirection } from '@/i18n/direction';
import type { CustomEmoji } from '@/lib/nostr/custom-emoji';
import { IS_ELECTRON } from '@/lib/platform';
import { iconStrokeWidth } from '@/theme/icons';
import { emojiSize, radius, spacing, typography, useThemeColors } from '@/theme';

import {
  calculateCustomEmojiGridLayout,
  type CustomEmojiGridLayout,
} from './custom-emoji-grid-layout';
import { CustomEmojiImage } from './CustomEmojiImage';

export type { CustomEmojiGridLayout } from './custom-emoji-grid-layout';

// Registered optical exception (DESIGN §8): halfway between the 4px and
// 8px spacing tokens. It leaves a visible hover frame without crowding artwork.
export const CUSTOM_EMOJI_CELL_PADDING = spacing.md / 2;

export function resolveCustomEmojiGridLayout(
  containerWidth: number,
  horizontalPadding: number,
): CustomEmojiGridLayout {
  const cellPadding = CUSTOM_EMOJI_CELL_PADDING;
  return calculateCustomEmojiGridLayout({
    containerWidth,
    // `horizontalPadding` names the visible artwork gutter. Let the hover cell
    // extend into that gutter so its padded artwork still aligns with adjacent
    // page/header content.
    horizontalPadding: Math.max(0, horizontalPadding - cellPadding),
    isElectron: IS_ELECTRON,
    touchColumns: 4,
    desktopMinColumns: 5,
    desktopMinCellSize: emojiSize.packImage + cellPadding * 2,
    desktopMaxCellSize: emojiSize.composerPickerImage + cellPadding * 2,
    desktopPreferredGap: spacing.sm,
    cellPadding,
    imageLabelGap: spacing.xs,
    captionLineHeight: typography.caption.lineHeight,
    verticalPadding: 3,
  });
}

type LeadingAction = {
  label: string;
  onPress: () => void;
  icon?: 'add' | 'done';
};

export type CustomEmojiGridCellArgs = {
  emoji: CustomEmoji;
  index: number;
  image: ReactNode;
  label: ReactNode;
  layout: CustomEmojiGridLayout;
};

type GridRow = {
  emojis: CustomEmoji[];
  emojiStartIndex: number;
  hasLeadingAction: boolean;
};

function chunkRows(
  emojis: CustomEmoji[],
  columns: number,
  reserveLeadingAction: boolean,
): GridRow[] {
  if (!reserveLeadingAction && emojis.length === 0) return [];

  const rows: GridRow[] = [];
  const firstRowCapacity = reserveLeadingAction ? columns - 1 : columns;
  rows.push({
    emojis: emojis.slice(0, firstRowCapacity),
    emojiStartIndex: 0,
    hasLeadingAction: reserveLeadingAction,
  });

  for (let index = firstRowCapacity; index < emojis.length; index += columns) {
    rows.push({
      emojis: emojis.slice(index, index + columns),
      emojiStartIndex: index,
      hasLeadingAction: false,
    });
  }
  return rows;
}

type Props = {
  emojis: CustomEmoji[];
  horizontalPadding?: number;
  onSelect?: (emoji: CustomEmoji) => void;
  renderEmojiCell?: (args: CustomEmojiGridCellArgs) => ReactNode;
  leadingAction?: LeadingAction;
  listHeader?: ReactElement | null;
  emptyComponent?: ReactElement | null;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  extraData?: unknown;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  scrollEventThrottle?: number;
  removeClippedSubviews?: boolean;
  embedded?: boolean;
  onLayoutResolved?: (layout: CustomEmojiGridLayout) => void;
};

/** Shared responsive custom-emoji grid for full pages, pickers, and embedded sheets. */
export const CustomEmojiGrid = memo(function CustomEmojiGrid({
  emojis,
  horizontalPadding = spacing.lg,
  onSelect,
  renderEmojiCell,
  leadingAction,
  listHeader,
  emptyComponent,
  contentContainerStyle,
  style,
  extraData,
  onScroll,
  scrollEventThrottle,
  removeClippedSubviews = true,
  embedded = false,
  onLayoutResolved,
}: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const direction = useLanguageDirection();
  const [containerWidth, setContainerWidth] = useState(windowWidth);
  const layout = useMemo(
    () => resolveCustomEmojiGridLayout(containerWidth, horizontalPadding),
    [containerWidth, horizontalPadding],
  );
  const hasLeadingAction = leadingAction !== undefined;
  const rows = useMemo(
    () => chunkRows(emojis, layout.columns, hasLeadingAction),
    [emojis, layout.columns, hasLeadingAction],
  );

  useEffect(() => {
    onLayoutResolved?.(layout);
  }, [layout, onLayoutResolved]);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    setContainerWidth((current) => (current === nextWidth ? current : nextWidth));
  }, []);

  const renderRow = useCallback(
    ({ item }: { item: GridRow }) => (
      <CustomEmojiGridRow
        emojis={item.emojis}
        emojiStartIndex={item.emojiStartIndex}
        horizontalPadding={layout.gridPadding}
        layout={layout}
        leadingAction={item.hasLeadingAction ? leadingAction : undefined}
        onSelect={onSelect}
        renderEmojiCell={renderEmojiCell}
        direction={direction}
      />
    ),
    [direction, layout, leadingAction, onSelect, renderEmojiCell],
  );

  if (embedded) {
    return (
      <View onLayout={handleLayout} style={style}>
        {rows.map((row, index) => (
          <CustomEmojiGridRow
            key={`embedded:${row.emojiStartIndex}:${index}`}
            emojis={row.emojis}
            emojiStartIndex={row.emojiStartIndex}
            horizontalPadding={layout.gridPadding}
            layout={layout}
            leadingAction={row.hasLeadingAction ? leadingAction : undefined}
            onSelect={onSelect}
            renderEmojiCell={renderEmojiCell}
            direction={direction}
          />
        ))}
      </View>
    );
  }

  return (
    <FlatList
      style={style}
      data={rows}
      extraData={[extraData, layout]}
      keyExtractor={(row, index) => `${row.emojiStartIndex}:${index}`}
      renderItem={renderRow}
      ListHeaderComponent={listHeader}
      ListEmptyComponent={emptyComponent}
      onLayout={handleLayout}
      getItemLayout={
        listHeader
          ? undefined
          : (_, index) => ({
              length: layout.rowHeight,
              offset: layout.rowHeight * index,
              index,
            })
      }
      keyboardShouldPersistTaps="always"
      onScroll={onScroll}
      scrollEventThrottle={scrollEventThrottle}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={contentContainerStyle}
      removeClippedSubviews={removeClippedSubviews}
      initialNumToRender={6}
      maxToRenderPerBatch={6}
      updateCellsBatchingPeriod={40}
      windowSize={7}
    />
  );
});

type RowProps = {
  emojis: CustomEmoji[];
  layout: CustomEmojiGridLayout;
  horizontalPadding: number;
  onSelect?: (emoji: CustomEmoji) => void;
  emojiStartIndex: number;
  renderEmojiCell?: (args: CustomEmojiGridCellArgs) => ReactNode;
  leadingAction?: LeadingAction;
  direction: 'ltr' | 'rtl';
};

const CustomEmojiGridRow = memo(function CustomEmojiGridRow({
  emojis,
  layout,
  horizontalPadding,
  onSelect,
  emojiStartIndex,
  renderEmojiCell,
  leadingAction,
  direction,
}: RowProps) {
  const c = useThemeColors();
  const { columns, cellSize, artworkSize, rowHeight } = layout;

  return (
    <View
      style={{
        direction,
        flexDirection: 'row',
        justifyContent: 'space-between',
        height: rowHeight,
        paddingHorizontal: horizontalPadding,
      }}
    >
      {Array.from({ length: columns }, (_, index) => {
        if (index === 0 && leadingAction) {
          return (
            <View
              key="leading-action"
              style={{
                width: cellSize,
                height: rowHeight,
                alignItems: 'center',
                justifyContent: 'center',
                gap: spacing.xs,
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={leadingAction.label}
                onPress={leadingAction.onPress}
                style={({ pressed }) => ({
                  width: artworkSize,
                  height: artworkSize,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1,
                  borderStyle: leadingAction.icon === 'done' ? 'solid' : 'dashed',
                  borderColor: leadingAction.icon === 'done' ? c.accent : c.border,
                  borderRadius: radius.sm,
                  borderCurve: 'continuous',
                  backgroundColor: pressed ? c.interactionOverlay : 'transparent',
                })}
              >
                {leadingAction.icon === 'done' ? (
                  <Check strokeWidth={iconStrokeWidth.default} size={26} color={c.accent} />
                ) : (
                  <Plus strokeWidth={iconStrokeWidth.default} size={26} color={c.textMuted} />
                )}
              </Pressable>
              <AppText
                variant="caption"
                tone={leadingAction.icon === 'done' ? 'accent' : 'muted'}
                numberOfLines={1}
                style={{ maxWidth: cellSize }}
              >
                {leadingAction.label}
              </AppText>
            </View>
          );
        }

        const emoji = emojis[leadingAction ? index - 1 : index];
        if (!emoji) return <View key={`empty-${index}`} style={{ width: cellSize }} />;
        const emojiIndex = emojiStartIndex + (leadingAction ? index - 1 : index);
        const image = (
          <CustomEmojiImage
            emoji={emoji}
            size={artworkSize}
            clickable={false}
            cornerRadius={radius.xs}
          />
        );
        const label = (
          <AppText
            variant="caption"
            tone="muted"
            numberOfLines={1}
            style={{ maxWidth: cellSize, pointerEvents: 'none' }}
          >
            {emoji.shortcode}
          </AppText>
        );

        if (renderEmojiCell) {
          return (
            <View
              key={`${emoji.shortcode}:${emoji.url}`}
              style={{ width: cellSize, height: rowHeight, overflow: 'visible' }}
            >
              {renderEmojiCell({ emoji, index: emojiIndex, image, label, layout })}
            </View>
          );
        }

        const cellStyle = {
          width: cellSize,
          height: rowHeight,
          alignItems: 'center' as const,
          justifyContent: 'center' as const,
          gap: spacing.xs,
        };
        if (!onSelect) {
          return (
            <View key={`${emoji.shortcode}:${emoji.url}`} style={cellStyle}>
              <View
                style={{
                  width: cellSize,
                  height: cellSize,
                  padding: CUSTOM_EMOJI_CELL_PADDING,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {image}
              </View>
              {label}
            </View>
          );
        }

        return (
          <Pressable
            key={`${emoji.shortcode}:${emoji.url}`}
            accessibilityLabel={emoji.shortcode}
            onPress={() => onSelect(emoji)}
            fallbackHoverOpacity={false}
            style={cellStyle}
          >
            {({ pressed }) => (
              <>
                <View
                  style={{
                    width: cellSize,
                    height: cellSize,
                    padding: CUSTOM_EMOJI_CELL_PADDING,
                    borderRadius: radius.sm,
                    borderCurve: 'continuous',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: pressed ? c.interactionOverlay : 'transparent',
                  }}
                >
                  {image}
                </View>
                {label}
              </>
            )}
          </Pressable>
        );
      })}
    </View>
  );
});
