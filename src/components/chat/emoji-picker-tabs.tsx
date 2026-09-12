import { Plain as Plane } from '@solar-icons/react-native/category/messages/Linear/Plain';
import { CupHot as Coffee } from '@solar-icons/react-native/category/food/Linear/CupHot';
import { Flag } from '@solar-icons/react-native/category/ui/Linear/Flag';
import { Box as Package } from '@solar-icons/react-native/category/ui/Linear/Box';
import { CupFirst as Trophy } from '@solar-icons/react-native/category/ui/Linear/CupFirst';
import { UserHandUp as Hand } from '@solar-icons/react-native/category/users/Linear/UserHandUp';
import { Heart } from '@solar-icons/react-native/category/like/Linear/Heart';
import { Leaf } from '@solar-icons/react-native/category/nature/Linear/Leaf';
import { Lightbulb } from '@solar-icons/react-native/category/devices/Linear/Lightbulb';
import { SmileCircle as Smile } from '@solar-icons/react-native/category/faces/Linear/SmileCircle';
import type { Icon as SolarIcon } from '@solar-icons/react-native/lib/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, type LayoutRectangle } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';
import { useTranslation } from 'react-i18next';

import { EdgeFade } from '@/components/common/EdgeFade';
import { CustomEmojiImage } from '@/components/emoji/CustomEmojiImage';
import Plus from 'lucide-react-native/icons/plus';
import { useLanguageDirection } from '@/i18n/direction';
import type { CustomEmoji, EmojiPack } from '@/lib/nostr/custom-emoji';
import { IS_ELECTRON } from '@/lib/platform';
import { iconStrokeWidth } from '@/theme/icons';
import {
  emojiPickerLayout,
  emojiSize,
  radius,
  spacing,
  uiDensity,
  useThemeColors,
} from '@/theme';

export const STANDALONE_EMOJI_TAB = 'standalone';

type Props = {
  activePack: string | null;
  activeCategory?: string;
  customPacks: EmojiPack[];
  standaloneCustomEmojis: CustomEmoji[];
  onOpenEmojiPacks?: () => void;
  onSelectPack: (coordinate: string) => void;
  onSelectCategory?: (slug: string) => void;
  showUnicodeCategories?: boolean;
  backgroundColor?: string;
  unicodeGroups?: readonly { slug: string }[];
};

const CATEGORY_ICON: Record<string, SolarIcon> = {
  smileys_emotion: Smile,
  people_body: Hand,
  animals_nature: Leaf,
  food_drink: Coffee,
  travel_places: Plane,
  activities: Trophy,
  objects: Lightbulb,
  symbols: Heart,
  flags: Flag,
};

const TAB_SIZE = uiDensity.composerActionSize;
const TAB_GAP = spacing.xs;

type TabProps = {
  active: boolean;
  accessibilityLabel: string;
  children: React.ReactNode;
  onPress: () => void;
  onActiveLayout?: (layout: LayoutRectangle | null) => void;
  size?: number;
};

function EmojiTab({
  active,
  accessibilityLabel,
  children,
  onPress,
  onActiveLayout,
  size = TAB_SIZE,
}: TabProps) {
  const c = useThemeColors();
  const layoutRef = useRef<LayoutRectangle | null>(null);

  useEffect(() => {
    if (active) onActiveLayout?.(layoutRef.current);
  }, [active, onActiveLayout]);

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      onLayout={(event) => {
        layoutRef.current = event.nativeEvent.layout;
        if (active) onActiveLayout?.(layoutRef.current);
      }}
      style={({ pressed }) => ({
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.md,
        backgroundColor: active
          ? c.textMuted + '26'
          : pressed
            ? c.interactionOverlay
            : 'transparent',
      })}
    >
      {children}
    </Pressable>
  );
}

/**
 * The shared source rail for one picker mode at a time. Custom mode shows the
 * fixed standalone Heart, pack covers, and management action; Unicode mode shows
 * only category icons. The reaction picker never mixes both sets in one rail.
 */
export function EmojiPickerTabs({
  activePack,
  activeCategory,
  customPacks,
  standaloneCustomEmojis,
  onOpenEmojiPacks,
  onSelectPack,
  onSelectCategory,
  showUnicodeCategories = true,
  backgroundColor,
  unicodeGroups = [],
}: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const direction = useLanguageDirection();
  const reducedMotion = useReducedMotion();
  const hasCustomSources = standaloneCustomEmojis.length > 0 || customPacks.length > 0;
  const customOnly = !showUnicodeCategories;
  const tabSize = TAB_SIZE;
  const railPadding = emojiPickerLayout.horizontalGutter;
  const scrollRef = useRef<ScrollView>(null);
  const activeLayoutRef = useRef<LayoutRectangle | null>(null);
  const viewportWidthRef = useRef(0);
  const contentWidthRef = useRef(0);
  const scrollXRef = useRef(0);
  const fadeVisibleRef = useRef(false);
  const [fadeVisible, setFadeVisible] = useState(false);

  const updateFadeVisibility = useCallback(() => {
    const viewportWidth = viewportWidthRef.current;
    const contentWidth = contentWidthRef.current;
    const nextVisible =
      contentWidth > viewportWidth &&
      (direction === 'rtl'
        ? scrollXRef.current > spacing.xs
        : scrollXRef.current + viewportWidth < contentWidth - spacing.xs);
    if (nextVisible === fadeVisibleRef.current) return;
    fadeVisibleRef.current = nextVisible;
    setFadeVisible(nextVisible);
  }, [direction]);

  const revealActiveTab = useCallback(() => {
    const layout = activeLayoutRef.current;
    const viewportWidth = viewportWidthRef.current;
    const contentWidth = contentWidthRef.current;
    if (!layout || viewportWidth <= 0 || contentWidth <= 0) return;

    // Keep the selected tab clear of the trailing fade. Measurements and
    // offsets share physical coordinates; only the content order is RTL.
    const leftInset = direction === 'rtl' ? emojiPickerLayout.endFadeWidth : railPadding;
    const rightInset = direction === 'rtl' ? railPadding : emojiPickerLayout.endFadeWidth;
    const currentX = scrollXRef.current;
    let nextX = currentX;
    if (layout.x < currentX + leftInset) {
      nextX = layout.x - leftInset;
    } else if (layout.x + layout.width > currentX + viewportWidth - rightInset) {
      nextX = layout.x + layout.width + rightInset - viewportWidth;
    }
    nextX = Math.max(0, Math.min(nextX, contentWidth - viewportWidth));
    if (nextX === currentX) return;
    scrollXRef.current = nextX;
    scrollRef.current?.scrollTo({ x: nextX, animated: !reducedMotion });
    updateFadeVisibility();
  }, [direction, railPadding, reducedMotion, updateFadeVisibility]);

  const handleActiveLayout = useCallback((layout: LayoutRectangle | null) => {
    activeLayoutRef.current = layout;
    revealActiveTab();
  }, [revealActiveTab]);

  return (
    <View
      style={{
        direction,
        position: 'relative',
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: c.border,
      }}
    >
      <ScrollView
        ref={scrollRef}
        horizontal
        style={{ direction: 'ltr' }}
        accessibilityRole="tablist"
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onLayout={(event) => {
          viewportWidthRef.current = event.nativeEvent.layout.width;
          revealActiveTab();
          updateFadeVisibility();
        }}
        onContentSizeChange={(width) => {
          contentWidthRef.current = width;
          revealActiveTab();
          updateFadeVisibility();
        }}
        onScroll={(event) => {
          scrollXRef.current = event.nativeEvent.contentOffset.x;
          updateFadeVisibility();
        }}
        scrollEventThrottle={16}
        contentContainerStyle={{
          direction,
          alignItems: 'center',
          paddingHorizontal: railPadding,
          paddingVertical: spacing.xs,
          gap: TAB_GAP,
        }}
      >
      {customOnly || hasCustomSources ? (
        <EmojiTab
          active={activePack === STANDALONE_EMOJI_TAB}
          onActiveLayout={handleActiveLayout}
          accessibilityLabel={t('chat.emoji.saved')}
          onPress={() => onSelectPack(STANDALONE_EMOJI_TAB)}
          size={tabSize}
        >
          <Heart
            size={IS_ELECTRON ? 20 : 22}
            color={activePack === STANDALONE_EMOJI_TAB ? c.accent : c.text}
          />
        </EmojiTab>
      ) : null}

      {customPacks.map((pack) => {
        const cover = pack.emojis[0];
        return (
          <EmojiTab
            key={pack.coordinate}
            active={activePack === pack.coordinate}
            onActiveLayout={handleActiveLayout}
            accessibilityLabel={pack.title || t('emoji.untitled_pack')}
            onPress={() => onSelectPack(pack.coordinate)}
            size={tabSize}
          >
            {cover ? (
              <CustomEmojiImage
                emoji={cover}
                size={
                  IS_ELECTRON
                    ? emojiSize.desktopSourceTabImage
                    : emojiSize.sourceTabImage
                }
                clickable={false}
                cornerRadius={radius.sm}
              />
            ) : (
              <Package size={IS_ELECTRON ? 18 : 20} color={c.text} />
            )}
          </EmojiTab>
        );
      })}

      {onOpenEmojiPacks ? (
        <EmojiTab
          active={false}
          accessibilityLabel={t('emoji.my_packs')}
          onPress={onOpenEmojiPacks}
          size={tabSize}
        >
          <Plus strokeWidth={iconStrokeWidth.default} size={IS_ELECTRON ? 20 : 22} color={c.text} />
        </EmojiTab>
      ) : null}

      {hasCustomSources && showUnicodeCategories ? (
        <View
          style={{
            width: StyleSheet.hairlineWidth,
            height: 24,
            marginHorizontal: spacing.xs,
            backgroundColor: c.border,
          }}
        />
      ) : null}

      {showUnicodeCategories ? unicodeGroups.map((group) => {
        const Icon = CATEGORY_ICON[group.slug] ?? Smile;
        const active = activePack === null && activeCategory === group.slug;
        return (
          <EmojiTab
            key={group.slug}
            active={active}
            onActiveLayout={handleActiveLayout}
            accessibilityLabel={t(`chat.emoji.categories.${group.slug}`)}
            onPress={() => onSelectCategory?.(group.slug)}
          >
            <Icon size={19} color={active ? c.accent : c.text} />
          </EmojiTab>
        );
      }) : null}
      </ScrollView>
      {fadeVisible ? (
        <EdgeFade
          edge="end"
          color={backgroundColor ?? c.background}
          width={emojiPickerLayout.endFadeWidth}
        />
      ) : null}
    </View>
  );
}
