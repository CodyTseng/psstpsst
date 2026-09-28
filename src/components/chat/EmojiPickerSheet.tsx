import { router } from 'expo-router';
import {
  type ComponentType,
  memo,
  type ReactElement,
  type Ref,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  FlatList,
  type FlatListProps,
  type ListRenderItemInfo,
  Keyboard,
  Modal,
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, {
  type AnimatedProps,
  Easing,
  FadeIn,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/components/common/AppText";
import { SegmentedControl } from "@/components/common/SegmentedControl";
import { useAddCustomEmoji } from "@/hooks/use-add-custom-emoji";
import { useLanguageDirection } from "@/i18n/direction";
import { ALL_EMOJI, EMOJI_GROUPS, type EmojiItem } from "@/lib/emoji/data";
import type { CustomEmoji, EmojiPack } from "@/lib/nostr/custom-emoji";
import { IS_ELECTRON } from "@/lib/platform";
import {
  contentWidth,
  emojiPickerLayout,
  emojiSize,
  radius,
  shadow,
  spacing,
  useThemeColors,
} from "@/theme";

import { EmojiPickerPanel } from "./EmojiPickerPanel";
import { EmojiPickerSearchField } from "./emoji-picker-search-field";
import { EmojiPickerTabs } from "./emoji-picker-tabs";

export type EmojiPickerPopoverAnchor = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Fired after the picker has fully closed and its native Modal is gone. */
  onClosed?: () => void;
  onSelect: (emoji: string | CustomEmoji) => void;
  customPacks?: EmojiPack[];
  standaloneCustomEmojis?: CustomEmoji[];
  /** Restrict this invocation to Unicode reactions and omit the mode switch. */
  unicodeOnly?: boolean;
  /** The mode the picker opens (and resets) in. Default "unicode"; the composer
   * starts on "custom", matching its touch counterpart's custom-only panel. */
  initialMode?: PickerMode;
  /** Allow collection editing when this picker is owned by the composer. */
  allowStandaloneEditing?: boolean;
  /** Electron pointer anchor; when present, use a floating surface instead of a sheet. */
  popoverAnchor?: EmojiPickerPopoverAnchor;
};

const H_PAD = emojiPickerLayout.horizontalGutter;
const CELL = IS_ELECTRON ? 40 : 44;
const GRID_EMOJI_STYLE = IS_ELECTRON
  ? emojiSize.desktopGrid
  : emojiSize.grid;
const HEADER_H = 32;
// Pull-down-to-dismiss thresholds (drag distance / fling velocity), matching
// the shared BottomSheet so the gesture feels identical across the app.
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 800;
const OPEN_MS = 260;
const CLOSE_MS = 200;
const MODE_SWITCH_HEIGHT = 40;
const MODE_SWITCH_CONTENT_GAP = spacing.xl;
const POPOVER_WIDTH = 400;
const POPOVER_HEIGHT = 400;
const POPOVER_MIN_HEIGHT = 240;

type Row =
  | { type: "header"; slug: string }
  | { type: "row"; slug: string; emojis: EmojiItem[] };

type PickerMode = "unicode" | "custom";

type PreparedEmojiRows = {
  items: Row[];
  headerIndexByGroup: Record<string, number>;
  stickyHeaderIndices: number[];
  layout: number[];
};

const EMPTY_PREPARED_EMOJI_ROWS: PreparedEmojiRows = {
  items: [],
  headerIndexByGroup: {},
  stickyHeaderIndices: [],
  layout: [],
};
const preparedEmojiRowsByColumns = new Map<number, PreparedEmojiRows>();

function prepareEmojiRows(columns: number): PreparedEmojiRows {
  const cached = preparedEmojiRowsByColumns.get(columns);
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
    items.push({ type: "header", slug: group.slug });
    offset += HEADER_H;
    for (const emojis of chunk(group.emojis, columns)) {
      layout.push(offset);
      items.push({ type: "row", slug: group.slug, emojis });
      offset += CELL;
    }
  }

  const prepared = { items, headerIndexByGroup, stickyHeaderIndices, layout };
  preparedEmojiRowsByColumns.set(columns, prepared);
  return prepared;
}

// Reanimated-driven FlatList so its scroll offset can be read on the UI thread
// (needed to coordinate the drag-to-dismiss pan with the inner scroll).
// `createAnimatedComponent` widens the item type to `unknown`, so re-assert the
// `Row` generic to keep the render callbacks typed.
const AnimatedFlatList = Animated.createAnimatedComponent(
  FlatList,
) as unknown as ComponentType<
  AnimatedProps<FlatListProps<Row>> & { ref?: Ref<FlatList<Row>> }
>;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const ignorePackSelection = () => {};

/** Android must leave the FlatList outside a composed gesture boundary so its
 * native view keeps the full velocity history for fast flings. The sizeable
 * fixed header remains a pull-down dismissal target on that platform. */
function EmojiListGestureBoundary({
  children,
  gesture,
  disabled = false,
}: {
  children: ReactElement;
  gesture: ReturnType<typeof Gesture.Simultaneous>;
  disabled?: boolean;
}) {
  if (disabled || Platform.OS === "android") return children;
  return <GestureDetector gesture={gesture}>{children}</GestureDetector>;
}

/** A single grid row of emoji buttons. Memoized — rows never change once built,
 * so scrolling re-renders nothing. */
const EmojiRow = memo(function EmojiRow({
  emojis,
  columns,
  onPick,
  color,
  interactionOverlay,
  direction,
}: {
  emojis: EmojiItem[];
  columns: number;
  onPick: (emoji: string) => void;
  color: string;
  interactionOverlay: string;
  direction: 'ltr' | 'rtl';
}) {
  return (
    <View
      style={{
        direction,
        flexDirection: "row",
        justifyContent: "space-between",
        height: CELL,
        paddingHorizontal: H_PAD,
      }}
    >
      {Array.from({ length: columns }, (_, index) => {
        const e = emojis[index];
        if (!e) return <View key={`empty-${index}`} style={{ width: CELL }} />;
        return (
          <Pressable
            key={e.slug}
            onPress={() => onPick(e.emoji)}
            style={({ pressed }) => ({
              width: CELL,
              height: CELL,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.md,
              backgroundColor: pressed ? interactionOverlay : "transparent",
            })}
          >
            {/* A grid can mount dozens of glyphs in one scroll frame. Plain Text
                avoids one theme-store subscription per emoji while preserving
                the named emoji typography and resolved theme colour. */}
            <Text style={[GRID_EMOJI_STYLE, { color }]}>{e.emoji}</Text>
          </Pressable>
        );
      })}
    </View>
  );
});

/**
 * Our own full emoji picker — fully in the design system (no third-party
 * chrome). Touch uses a bottom-anchored card (rounded top, grabber, safe-area
 * inset) sliding over a fading scrim; Electron can swap that shell for a
 * button-anchored pointer card. Both presentations keep Unicode emoji and
 * custom packs as separate modes: Unicode owns categories and its fixed-row
 * grid; custom mode reuses the composer's `EmojiPickerPanel`. Both modes share
 * the same quiet search field — Unicode matches emoji names, custom matches
 * shortcodes across every source.
 *
 * Dismissal mirrors the shared `BottomSheet`: tap the scrim, or drag the card
 * down — the card follows the finger and dismisses past a threshold, while the
 * grid scrolls otherwise. The pan and the grid's native scroll run together on
 * the UI thread (a shared `scrollY`) so the card only follows the finger when
 * the grid is at its top and the drag is downward; otherwise the grid scrolls.
 */
export function EmojiPickerSheet({
  visible,
  onClose,
  onClosed,
  onSelect,
  customPacks = [],
  standaloneCustomEmojis = [],
  unicodeOnly = false,
  initialMode = "unicode",
  allowStandaloneEditing = false,
  popoverAnchor,
}: Props) {
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const direction = useLanguageDirection();
  const { width: W, height: H } = useWindowDimensions();
  const addStandaloneEmoji = useAddCustomEmoji();
  const floating = IS_ELECTRON && popoverAnchor != null;
  const modeSwitchBottomGap = floating ? spacing.sm : 0;
  const contentBottomInset = unicodeOnly
    ? (floating ? 0 : insets.bottom) + spacing.md
    : (floating ? 0 : insets.bottom) +
      MODE_SWITCH_HEIGHT +
      MODE_SWITCH_CONTENT_GAP +
      modeSwitchBottomGap;
  // Keyboard movement on the reanimated timeline (`height` 0 → -keyboardHeight,
  // `progress` 0 → 1) so the card rides above the keyboard when the search field
  // is focused, all on the UI thread with the drag/scroll.
  const kb = useReanimatedKeyboardAnimation();

  const [mode, setMode] = useState<PickerMode>(initialMode);
  const pickerMode: PickerMode = unicodeOnly ? "unicode" : mode;
  const [query, setQuery] = useState("");
  const [filterQuery, setFilterQuery] = useState("");
  const [activeSlug, setActiveSlug] = useState(EMOJI_GROUPS[0].slug);
  const listRef = useRef<FlatList<Row>>(null);
  const pendingCategoryRef = useRef<string | null>(null);

  const availableAbove = popoverAnchor
    ? popoverAnchor.y - spacing.sm * 2
    : 0;
  const availableBelow = popoverAnchor
    ? H - (popoverAnchor.y + popoverAnchor.height) - spacing.sm * 2
    : 0;
  const placePopoverAbove = availableAbove >= availableBelow;
  const popoverAvailableHeight = placePopoverAbove
    ? availableAbove
    : availableBelow;
  const CARD_H = floating
    ? Math.min(
        POPOVER_HEIGHT,
        H - spacing.sm * 2,
        Math.max(POPOVER_MIN_HEIGHT, popoverAvailableHeight),
      )
    : Math.min(H * 0.52, 420);
  const cardWidth = floating
    ? Math.min(POPOVER_WIDTH, W - spacing.sm * 2)
    : Math.min(W, contentWidth.sheet);
  const popoverLeft = popoverAnchor
    ? Math.max(
        spacing.sm,
        Math.min(
          popoverAnchor.x + popoverAnchor.width - cardWidth,
          W - spacing.sm - cardWidth,
        ),
      )
    : spacing.sm;
  const popoverTop = popoverAnchor
    ? placePopoverAbove
      ? Math.max(spacing.sm, popoverAnchor.y - spacing.sm - CARD_H)
      : Math.min(
          H - spacing.sm - CARD_H,
          popoverAnchor.y + popoverAnchor.height + spacing.sm,
        )
    : spacing.sm;
  const columns = Math.max(6, Math.floor((cardWidth - H_PAD * 2) / CELL));
  // Card travel: the single vertical position driving both the slide and the
  // finger drag — 0 = fully open, CLOSED_OFFSET = slid off-screen. One value
  // means a drag-release flows straight into the close (no separate `drag` term
  // left stranded at the release point), and the backdrop derives from it too.
  const CLOSED_OFFSET = CARD_H + insets.bottom + 40;

  const offsetY = useSharedValue(0);
  // The grid's scroll offset, mirrored on the UI thread so the pan can tell
  // whether the grid is at its top.
  const scrollY = useSharedValue(0);
  // Set true the moment a drag-release commits to dismiss, so the visible→false
  // effect knows the close is already animating (with momentum) and must not
  // re-drive it with a plain timing (which would stall at the release point).
  const dragClosing = useRef(false);
  const afterCloseRef = useRef<(() => void) | null>(null);
  const onClosedRef = useRef(onClosed);
  useEffect(() => {
    onClosedRef.current = onClosed;
  }, [onClosed]);

  const [mounted, setMounted] = useState(visible);
  // The heavy emoji grid (data build + FlatList mount) is deferred until the
  // slide-in has *finished* — never built on the first mount render or mid-slide
  // — so the open animation runs on a clean frame. Until then only the cheap
  // chrome (search + tabs) renders; the grid data memos below also gate on this.
  const [gridReady, setGridReady] = useState(false);
  // Tear-down after the card is off-screen (called from whichever animation
  // finishes the close — the effect's timing or the drag's momentum spring).
  const finishClose = useCallback(() => {
    const afterClose = afterCloseRef.current;
    afterCloseRef.current = null;
    setMounted(false);
    setGridReady(false);
    setMode(initialMode);
    setQuery("");
    setFilterQuery("");
    if (afterClose || onClosedRef.current) {
      setTimeout(() => {
        afterClose?.();
        onClosedRef.current?.();
      }, 0);
    }
  }, [initialMode]);
  useEffect(() => {
    if (visible) {
      setMounted(true);
      dragClosing.current = false; // a fresh open supersedes any pending close
      if (floating) {
        offsetY.value = 0;
        setGridReady(false);
        const timeout = setTimeout(() => setGridReady(true), 0);
        return () => clearTimeout(timeout);
      }
      offsetY.value = CLOSED_OFFSET; // start off-screen, then slide up
      offsetY.value = withTiming(
        0,
        { duration: OPEN_MS, easing: Easing.out(Easing.cubic) },
        // Build + mount the grid only once the panel has settled, so the heavy
        // work can never land on a frame the slide is still animating.
        (finished) => {
          if (finished) runOnJS(setGridReady)(true);
        },
      );
      return undefined;
    }
    if (floating) {
      finishClose();
      return undefined;
    }
    // A drag-release already started the momentum close + tear-down; don't
    // override it with a timing (that's what made it stall at the release point).
    if (dragClosing.current) {
      dragClosing.current = false;
      return undefined;
    }
    // Backdrop tap / programmatic close: slide out, then tear down once off-screen.
    offsetY.value = withTiming(
      CLOSED_OFFSET,
      { duration: CLOSE_MS, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(finishClose)();
      },
    );
    return undefined;
  }, [visible, floating, offsetY, CLOSED_OFFSET, finishClose]);

  useEffect(() => {
    if (!query) return;
    const timeout = setTimeout(() => setFilterQuery(query), 200);
    return () => clearTimeout(timeout);
  }, [query]);

  const scrollHandler = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  // Mark the close as drag-owned (so the effect won't re-drive it) and tell the
  // parent to flip `visible`. The momentum spring started in `settle` owns the
  // visual close + tear-down.
  const beginDragClose = useCallback(() => {
    dragClosing.current = true;
    onClose();
  }, [onClose]);

  // Pull-down-to-dismiss, coordinated with the grid's native scroll. Both run
  // simultaneously; the pan only drives the card while the grid is at the top
  // (scrollY <= 0) and the drag is downward — otherwise the grid scrolls.
  const { headerPan, contentPan, listGesture } = useMemo(() => {
    const settle = (translationY: number, velocityY: number) => {
      "worklet";
      if (translationY > DISMISS_DISTANCE || velocityY > DISMISS_VELOCITY) {
        // Continue off-screen from the current position carrying the release
        // velocity — momentum, no stall at the release point — then tear down.
        offsetY.value = withSpring(
          CLOSED_OFFSET,
          { velocity: velocityY, damping: 50, stiffness: 320, overshootClamping: true },
          (finished) => {
            if (finished) runOnJS(finishClose)();
          },
        );
        runOnJS(beginDragClose)();
      } else {
        // Snap back open, carrying the velocity so the release stays fluid.
        offsetY.value = withSpring(0, {
          velocity: velocityY,
          damping: 28,
          stiffness: 320,
          overshootClamping: true,
        });
      }
    };
    // Ungated dismiss pan for the non-scrolling regions (header / placeholder /
    // empty) — a downward drag always follows the finger and dismisses, no
    // matter where the grid happens to be scrolled. Two separate instances
    // because one gesture object can only attach to one GestureDetector.
    const makeUngated = () =>
      Gesture.Pan()
        .activeOffsetY(10)
        .onUpdate((e) => {
          "worklet";
          if (e.translationY > 0) offsetY.value = e.translationY;
        })
        .onEnd((e) => {
          "worklet";
          settle(e.translationY, e.velocityY);
        });
    // The grid's drag is coordinated with its native scroll: it only follows the
    // finger while the grid is at its top (scrollY <= 0) and the drag is
    // downward; otherwise the grid scrolls. Composed simultaneously so both the
    // scroll and the pan recognize the same touch.
    const native = Gesture.Native();
    const listPan = Gesture.Pan()
      .activeOffsetY(10)
      // Android requires the relationship in both directions; composition
      // alone can let the dismiss pan interrupt the FlatList's native fling.
      .simultaneousWithExternalGesture(native)
      .onUpdate((e) => {
        "worklet";
        if (scrollY.value <= 0 && e.translationY > 0)
          offsetY.value = e.translationY;
      })
      .onEnd((e) => {
        "worklet";
        if (scrollY.value <= 0) settle(e.translationY, e.velocityY);
      });
    native.simultaneousWithExternalGesture(listPan);
    return {
      headerPan: makeUngated(),
      contentPan: makeUngated(),
      listGesture: Gesture.Simultaneous(listPan, native),
    };
  }, [scrollY, offsetY, CLOSED_OFFSET, finishClose, beginDragClose]);

  // Flatten groups into [header, ...rows] items; remember each header's index
  // (for tab jumps) and the sticky-header indices. Gated on `gridReady` so the
  // ~1900-emoji build never runs on the first mount render or during the slide.
  // Prepared rows and offsets are retained by column count across picker opens.
  const preparedRows = useMemo(() => {
    if (!gridReady) return EMPTY_PREPARED_EMOJI_ROWS;
    return prepareEmojiRows(columns);
  }, [columns, gridReady]);
  const { items, headerIndexByGroup, stickyHeaderIndices } = preparedRows;

  const searchItems = useMemo<Row[] | null>(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return null;
    const matched = ALL_EMOJI.filter(
      (e) => e.name.includes(q) || e.slug.includes(q),
    );
    return chunk(matched, columns).map(
      (emojis) => ({ type: "row", slug: "search", emojis }) as Row,
    );
  }, [columns, filterQuery]);

  const data = searchItems ?? items;

  // Fixed heights → exact getItemLayout (header rows are shorter than emoji rows).
  const layout = useMemo(() => {
    if (!searchItems) return preparedRows.layout;
    const offsets: number[] = [];
    let off = 0;
    for (const it of data) {
      offsets.push(off);
      off += it.type === "header" ? HEADER_H : CELL;
    }
    return offsets;
  }, [data, preparedRows.layout, searchItems]);

  // Track the visible group so the active tab follows scrolling. Stable refs:
  // RN forbids changing these at runtime.
  const onViewable = useRef(
    ({ viewableItems }: { viewableItems: { item: Row }[] }) => {
      const top = viewableItems[0]?.item;
      if (top && top.slug !== "search") setActiveSlug(top.slug);
    },
  ).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 0 }).current;

  useEffect(() => {
    const pending = pendingCategoryRef.current;
    if (!pending) return;
    const index = headerIndexByGroup[pending];
    if (index == null) return;
    pendingCategoryRef.current = null;
    listRef.current?.scrollToIndex({ index, animated: false });
  }, [headerIndexByGroup, query]);

  function jumpTo(slug: string) {
    setActiveSlug(slug);
    if (query.trim()) {
      pendingCategoryRef.current = slug;
      setQuery("");
      setFilterQuery("");
      return;
    }
    const index = headerIndexByGroup[slug];
    if (index != null)
      listRef.current?.scrollToIndex({ index, animated: false });
  }

  const updateQuery = useCallback((value: string) => {
    setQuery(value);
    if (!value) setFilterQuery("");
  }, []);

  const selectMode = useCallback((nextMode: PickerMode) => {
    if (nextMode === pickerMode) return;
    Keyboard.dismiss();
    setMode(nextMode);
  }, [pickerMode]);

  const closeThen = useCallback((afterClose: () => void) => {
    afterCloseRef.current = afterClose;
    onClose();
  }, [onClose]);

  const addCustomEmoji = useCallback(() => {
    closeThen(() => {
      void addStandaloneEmoji();
    });
  }, [addStandaloneEmoji, closeThen]);

  const openEmojiPacks = useCallback(() => {
    closeThen(() => {
      router.push('/emoji-packs');
    });
  }, [closeThen]);

  const openEmojiAuthor = useCallback((authorPubkey: string) => {
    closeThen(() => {
      router.push({
        pathname: '/emoji-author/[pubkey]',
        params: { pubkey: authorPubkey },
      });
    });
  }, [closeThen]);

  // Card travel (`offsetY`: slide + live drag in one), plus the (negative)
  // keyboard height so the card rides up with the keyboard, plus a downward sink
  // of `insets.bottom` (scaled by the keyboard progress) so the card's safe-area
  // extension tucks *behind* the keyboard rather than showing as a strip
  // against its rounded top.
  const cardStyle = useAnimatedStyle(() => {
    const tuck = kb.progress.value * insets.bottom;
    return {
      transform: [{ translateY: offsetY.value + kb.height.value + tuck }],
    };
  });
  // Backdrop tracks the card: fully opaque when open, fading out as it slides
  // (or is dragged) toward closed.
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(Math.max(offsetY.value, 0) / CLOSED_OFFSET, 1),
  }));

  if (!mounted) return null;

  const surfaceColor = floating ? c.surfaceElevated : c.background;
  const pickerHeader = (
    <View style={floating ? { paddingTop: spacing.sm } : undefined}>
      {!floating ? (
        <View
          style={{
            alignSelf: "center",
            width: 36,
            height: 4,
            borderRadius: radius.sm,
            backgroundColor: c.border,
            marginTop: 8,
            marginBottom: 8,
          }}
        />
      ) : null}

      {pickerMode === "unicode" ? (
        <>
          <EmojiPickerSearchField value={query} onChangeText={updateQuery} />

          <EmojiPickerTabs
            activePack={null}
            activeCategory={activeSlug}
            backgroundColor={surfaceColor}
            customPacks={[]}
            standaloneCustomEmojis={[]}
            onSelectPack={ignorePackSelection}
            onSelectCategory={jumpTo}
            unicodeGroups={EMOJI_GROUPS}
          />
        </>
      ) : null}
    </View>
  );

  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      animationType="none"
      onRequestClose={onClose}
    >
      <GestureHandlerRootView
        style={{ flex: 1, justifyContent: floating ? undefined : "flex-end" }}
      >
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: floating ? "transparent" : c.overlay },
            floating ? undefined : backdropStyle,
          ]}
        >
          <Pressable hoverFeedback={false} style={{ flex: 1 }} onPress={onClose} />
        </Animated.View>

        <Animated.View
          style={[
            floating
              ? {
                  position: "absolute",
                  top: popoverTop,
                  left: popoverLeft,
                  height: CARD_H,
                  width: cardWidth,
                  overflow: "hidden",
                  backgroundColor: surfaceColor,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: c.border,
                  borderRadius: radius.lg,
                  ...shadow.float,
                }
              : {
                  height: CARD_H + insets.bottom,
                  width: "100%",
                  maxWidth: contentWidth.sheet,
                  alignSelf: "center",
                  backgroundColor: surfaceColor,
                  borderTopLeftRadius: radius["2xl"],
                  borderTopRightRadius: radius["2xl"],
                },
            floating ? undefined : cardStyle,
            { direction },
          ]}
        >
          {/* The grabber always owns an ungated dismiss pan. In Unicode mode,
              its non-scrolling search and category rail join that region. */}
          {floating ? (
            pickerHeader
          ) : (
            <GestureDetector gesture={headerPan}>{pickerHeader}</GestureDetector>
          )}

          {pickerMode === "custom" ? (
            gridReady ? (
              <Animated.View entering={FadeIn.duration(160)} style={{ flex: 1 }}>
                <EmojiPickerPanel
                  active
                  searchable
                  allowStandaloneEditing={allowStandaloneEditing}
                  backgroundColor={surfaceColor}
                  onAddStandaloneEmoji={addCustomEmoji}
                  onOpenEmojiAuthor={openEmojiAuthor}
                  onOpenEmojiPacks={openEmojiPacks}
                  onSelect={onSelect}
                  customPacks={customPacks}
                  standaloneCustomEmojis={standaloneCustomEmojis}
                  safeBottom={contentBottomInset}
                />
              </Animated.View>
            ) : (
              floating ? (
                <View style={{ flex: 1 }} />
              ) : (
                <GestureDetector gesture={contentPan}>
                  <View style={{ flex: 1 }} />
                </GestureDetector>
              )
            )
          ) : !gridReady ? (
            floating ? (
              <View style={{ flex: 1 }} />
            ) : (
              <GestureDetector gesture={contentPan}>
                <View style={{ flex: 1 }} />
              </GestureDetector>
            )
          ) : searchItems && searchItems.length === 0 ? (
            floating ? (
              <View
                style={{
                  flex: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  paddingBottom: contentBottomInset,
                }}
              >
                <AppText variant="body" tone="muted">
                  {t("chat.emoji.none")}
                </AppText>
              </View>
            ) : (
              <GestureDetector gesture={contentPan}>
                <View
                  style={{
                    flex: 1,
                    alignItems: "center",
                    justifyContent: "center",
                    paddingBottom: contentBottomInset,
                  }}
                >
                  <AppText variant="body" tone="muted">
                    {t("chat.emoji.none")}
                  </AppText>
                </View>
              </GestureDetector>
            )
          ) : (
            // Reanimated Web layout animations require a host DOM element.
            // FlatList exposes its component ref instead, so animate a host
            // wrapper while keeping the gesture boundary attached to the list.
            <Animated.View entering={FadeIn.duration(160)} style={{ flex: 1 }}>
              <EmojiListGestureBoundary gesture={listGesture} disabled={floating}>
                <AnimatedFlatList
                  ref={listRef}
                  data={data}
                  extraData={direction}
                  keyExtractor={(it, i) =>
                    it.type === "header" ? `h:${it.slug}` : `r:${it.slug}:${i}`
                  }
                  renderItem={({ item }: ListRenderItemInfo<Row>) =>
                    item.type === "header" ? (
                      <View
                        style={{
                          height: HEADER_H,
                          justifyContent: "center",
                          paddingHorizontal: H_PAD,
                          paddingVertical: spacing.xs,
                          backgroundColor: surfaceColor,
                        }}
                      >
                        <AppText variant="caption" weight="semibold" tone="muted">
                          {t(`chat.emoji.categories.${item.slug}`)}
                        </AppText>
                      </View>
                    ) : (
                      <EmojiRow
                        emojis={item.emojis}
                        columns={columns}
                        onPick={onSelect}
                        color={c.text}
                        interactionOverlay={c.interactionOverlay}
                        direction={direction}
                      />
                    )
                  }
                  getItemLayout={(_, index) => ({
                    length: data[index]?.type === "header" ? HEADER_H : CELL,
                    offset: layout[index] ?? 0,
                    index,
                  })}
                  stickyHeaderIndices={searchItems ? undefined : stickyHeaderIndices}
                  onViewableItemsChanged={onViewable}
                  viewabilityConfig={viewabilityConfig}
                  onScrollToIndexFailed={() => {}}
                  onScroll={scrollHandler}
                  scrollEventThrottle={16}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={{
                    paddingBottom: contentBottomInset,
                  }}
                  showsVerticalScrollIndicator={false}
                  // No rubber-band: at the top, a downward drag drives the
                  // pull-to-dismiss (the card follows the finger), so the grid
                  // itself must not also overscroll under it.
                  bounces={false}
                  removeClippedSubviews
                  initialNumToRender={6}
                  maxToRenderPerBatch={6}
                  updateCellsBatchingPeriod={40}
                  windowSize={7}
                />
              </EmojiListGestureBoundary>
            </Animated.View>
          )}

          {!unicodeOnly ? (
            <SegmentedControl
              compact
              value={pickerMode}
              options={[
                { value: "unicode", label: t("chat.emoji.unicode") },
                { value: "custom", label: t("chat.emoji.custom") },
              ]}
              onChange={selectMode}
              style={{
                position: "absolute",
                bottom: (floating ? 0 : insets.bottom) + modeSwitchBottomGap,
                ...shadow.float,
              }}
            />
          ) : null}
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}
