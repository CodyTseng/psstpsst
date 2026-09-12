import MaskedView from '@react-native-masked-view/masked-view';
import { BlurView } from 'expo-blur';
import { MenuDots as MoreHorizontal } from '@solar-icons/react-native/category/ui/Linear/MenuDots';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Platform,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OverKeyboardView } from 'react-native-keyboard-controller';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { AppText } from '@/components/common/AppText';
import {
  ACTION_MENU_ICON_SIZE,
  ACTION_MENU_METRICS,
  ActionMenuPanel,
  actionMenuHeight,
  type ActionMenuDensity,
  type ActionMenuItem,
} from '@/components/common/ActionMenuPanel';
import { CustomEmojiImage } from '@/components/emoji/CustomEmojiImage';
import type { FileAttachmentMeta } from '@/lib/nostr/file-tags';
import { IS_ELECTRON } from '@/lib/platform';
import type { ReactionAggregate } from '@/lib/nostr/reactions';
import {
  quickReactionKey,
  quickReactionLabel,
  type QuickReaction,
} from '@/lib/nostr/quick-reaction';
import type { MessageDelivery } from '@/stores/delivery-status.store';
import {
  emojiSize,
  radius,
  shadow,
  spacing,
  useEffectiveColorScheme,
  useThemeColors,
} from '@/theme';

import { BubbleBody, type RemoteContentMode } from './BubbleBody';
import { ElectronHoverGroup } from './electron-hover-group';
import type { EmojiPickerPopoverAnchor } from './EmojiPickerSheet';
import {
  placeDesktopMessageActionMenu,
  placeTouchMessageActionMenu,
} from './message-action-menu-placement';
import type { BubbleRect, MessageBubbleReplyPreview } from './MessageBubble';
import { ReactionsRow } from './ReactionsRow';

/** A row in the context menu below the lifted bubble. */
export type MessageMenuAction = {
  key: string;
  label: string;
  icon: ReactNode;
  /** Renders the row in the danger colour (e.g. Delete). */
  destructive?: boolean;
  onPress: () => void;
};

/** The data needed to render the lifted bubble copy (a subset of BubbleBody). */
export type LiftedBubble = {
  content: string;
  tags?: string[][] | null;
  isSelf: boolean;
  createdAt: number;
  rumorId?: string;
  persistedDelivery?: MessageDelivery | null;
  replyTo?: MessageBubbleReplyPreview | null;
  attachment?: FileAttachmentMeta | null;
  remoteContentMode?: RemoteContentMode;
  reactions?: ReactionAggregate[];
  /** Exact custom body for non-message rows such as failed uploads. */
  renderBody?: ReactNode;
};

type Props = {
  visible: boolean;
  /** Where the source bubble sits on screen — anchors the floating cluster. */
  rect: BubbleRect | null;
  bubble: LiftedBubble | null;
  /** The chat content viewport in window coords (titlebar bottom → input top).
   * The lifted copy is clipped to this so the part of the bubble scrolled under
   * the header / input is never painted — otherwise it would pop above the
   * titlebar as the menu opens and snap back as it closes. Defaults to the safe
   * area when absent. (Pill/menu still use the full safe area — they may float
   * over the blurred header/input.) */
  contentTop?: number;
  contentBottom?: number;
  /** Whether the software keyboard was visible when the menu opened. */
  preserveKeyboard?: boolean;
  /** Unicode or custom quick reactions shown above the bubble. */
  quickEmojis: QuickReaction[];
  /** Quick-reaction identities already used by the active account. */
  reactedReactionKeys?: string[];
  onReact: (reaction: QuickReaction) => void;
  /** Tap the "⋯" → open the full emoji picker. */
  onMore: (anchor?: EmojiPickerPopoverAnchor) => void;
  actions: MessageMenuAction[];
  onClose: () => void;
  /** Fired once the exit animation finishes and the menu has unmounted. Use it
   * to open another modal (e.g. the emoji picker) only after this one is gone —
   * iOS can't present two modals at once (the second silently fails and the
   * stuck one freezes touches). */
  onClosed?: () => void;
  hideReactions?: boolean;
};

const MARGIN = 12;
const GAP = 10;
// Electron stacks the reaction pill against the action panel (same side):
// there they read as one cluster, so their gap tightens below the surface GAP.
const ELECTRON_PILL_MENU_STACKED_GAP = spacing.xs;
const REACTION_PILL_METRICS = IS_ELECTRON
  ? {
      buttonSize: 32,
      visualSize: 16,
      moreIconSize: 16,
      gap: spacing.xs,
      paddingH: spacing.xs,
      paddingV: spacing.xs,
      unicodeStyle: { fontSize: 16, lineHeight: 20 },
    }
  : {
      buttonSize: 40,
      visualSize: emojiSize.quickReactionPillImage,
      moreIconSize: 22,
      gap: spacing.xs,
      paddingH: spacing.xs,
      paddingV: spacing.xs,
      unicodeStyle: emojiSize.quickReactionPill,
    };
const PILL_H =
  REACTION_PILL_METRICS.buttonSize +
  REACTION_PILL_METRICS.paddingV * 2 +
  StyleSheet.hairlineWidth * 2;
// How far up from a clipped copy's bottom edge it fades out into the backdrop.
const FADE_H = 48;
const ELECTRON_HOVER_CLOSE_DELAY_MS = 120;
// Slack around each Electron hover surface (source bubble / pill / menu). It
// bridges the intentional GAP between them and adds pointer-error margin, so
// crossing from one surface to another never reads as leaving the cluster.
const ELECTRON_HOVER_SLACK = 16;

type HoverRect = { left: number; top: number; right: number; bottom: number };

const MENU_DENSITY: ActionMenuDensity = IS_ELECTRON ? 'pointer' : 'touch';
export const MESSAGE_ACTION_MENU_ICON_SIZE = ACTION_MENU_ICON_SIZE[MENU_DENSITY];

type ReactionPillButtonProps = {
  active?: boolean;
  accessibilityLabel?: string;
  children: ReactNode;
  measureAnchorOnPress?: boolean;
  onPress: (anchor?: EmojiPickerPopoverAnchor) => void;
};

function ReactionPillButton({
  active = false,
  accessibilityLabel,
  children,
  measureAnchorOnPress = false,
  onPress,
}: ReactionPillButtonProps) {
  const c = useThemeColors();
  const [hovered, setHovered] = useState(false);
  const buttonRef = useRef<View>(null);

  function handlePress() {
    const button = buttonRef.current;
    if (!measureAnchorOnPress || !button) {
      onPress();
      return;
    }
    button.measureInWindow((x, y, width, height) => {
      onPress({ x, y, width, height });
    });
  }

  return (
    <Pressable
      ref={buttonRef}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={handlePress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      hitSlop={IS_ELECTRON ? 0 : 2}
      style={({ pressed }) => ({
        width: REACTION_PILL_METRICS.buttonSize,
        height: REACTION_PILL_METRICS.buttonSize,
        borderRadius: radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active
          ? c.accentSoft
          : pressed || (IS_ELECTRON && hovered)
            ? c.interactionOverlay
            : 'transparent',
      })}
    >
      {children}
    </Pressable>
  );
}

/**
 * Message context menu. Touch platforms focus the source with a backdrop and a
 * pixel-identical lifted copy; Electron keeps the original bubble as the only
 * copy and presents the pointer-density reaction pill and menu immediately.
 * Touch placement follows the measured bubble. Electron placement follows the
 * context-menu pointer while retaining the bubble rect for hover dismissal.
 */
export function MessageActionMenu({
  visible,
  rect,
  bubble,
  contentTop,
  contentBottom,
  preserveKeyboard = false,
  quickEmojis,
  reactedReactionKeys = [],
  onReact,
  onMore,
  actions,
  onClose,
  onClosed,
  hideReactions = false,
}: Props) {
  const c = useThemeColors();
  const scheme = useEffectiveColorScheme();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();

  // Retain the last valid render data so the *exit* animation can keep painting
  // the menu after the parent clears rect/bubble on close.
  const dataRef = useRef<{
    rect: BubbleRect;
    bubble: LiftedBubble;
    actions: MessageMenuAction[];
    contentTop?: number;
    contentBottom?: number;
    preserveKeyboard: boolean;
  } | null>(null);
  if (visible && rect && bubble) {
    dataRef.current = {
      rect,
      bubble,
      actions,
      contentTop,
      contentBottom,
      preserveKeyboard,
    };
  }

  // One progress value drives every part: backdrop blur fades in, the lifted
  // bubble eases up, and the pill/menu pop in (scaled, drifting off the bubble)
  // slightly staggered behind it. Native-driver friendly (opacity + transform).
  const progress = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const hoverGroupRef = useRef<ElectronHoverGroup<'cluster'> | null>(null);
  if (hoverGroupRef.current == null) {
    hoverGroupRef.current = new ElectronHoverGroup(ELECTRON_HOVER_CLOSE_DELAY_MS, () =>
      onCloseRef.current(),
    );
  }
  // The Electron hover-dismiss region: the source-bubble, pill, and menu rects,
  // each inflated by ELECTRON_HOVER_SLACK. Filled during render (like dataRef).
  const hoverRectsRef = useRef<HoverRect[]>([]);
  const [mounted, setMounted] = useState(visible);

  // Drive Electron hover dismissal from a window-level pointermove hit-test
  // against the inflated cluster rects. Per-element hover events (onHoverIn/Out,
  // onPointerEnter/Leave) churn out/in pairs when the pointer crosses child
  // content — and RNW can drop the re-enter — so they closed the menu while the
  // pointer was still over the message. One union hit-test has no such seam.
  useEffect(() => {
    if (!IS_ELECTRON || !visible) return;
    const group = hoverGroupRef.current;
    if (!group) return;
    const handlePointerMove = (e: PointerEvent) => {
      const inside = hoverRectsRef.current.some(
        (r) =>
          e.clientX >= r.left &&
          e.clientX <= r.right &&
          e.clientY >= r.top &&
          e.clientY <= r.bottom,
      );
      if (inside) group.enter('cluster');
      else group.leave('cluster');
    };
    window.addEventListener('pointermove', handlePointerMove, true);
    return () => window.removeEventListener('pointermove', handlePointerMove, true);
  }, [visible]);

  useEffect(() => {
    if (!visible) hoverGroupRef.current?.reset();
    if (visible) {
      setMounted(true);
      Animated.timing(progress, {
        toValue: 1,
        duration: IS_ELECTRON ? 0 : 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: Platform.OS !== 'web',
      }).start();
    } else {
      Animated.timing(progress, {
        toValue: 0,
        duration: IS_ELECTRON ? 0 : 160,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: Platform.OS !== 'web',
      }).start(({ finished }) => {
        if (finished) {
          setMounted(false);
          onClosed?.();
        }
      });
    }
  }, [visible, progress]);
  useEffect(
    () => () => hoverGroupRef.current?.reset(),
    [],
  );

  if (!mounted || !dataRef.current) return null;

  const view = dataRef.current;
  // With a translucent status bar, Android reports measureInWindow's y from
  // the app content origin while this Modal lays out from the physical screen
  // origin. Normalise that one inset so the lifted copy covers the real bubble.
  const windowOriginOffset = Platform.OS === 'android' ? insets.top : 0;
  const vRect =
    windowOriginOffset > 0
      ? { ...view.rect, y: view.rect.y + windowOriginOffset }
      : view.rect;
  const vBodyRect = view.rect.body
    ? {
        x: vRect.x + view.rect.body.offsetX,
        y: vRect.y + view.rect.body.offsetY,
        width: view.rect.body.width,
        height: view.rect.body.height,
      }
    : vRect;
  // The chat viewport is measured through the same measureInWindow API as the
  // bubble. Keep both in the Modal's physical-screen coordinate space; shifting
  // only the bubble falsely clips the last row by one status-bar height.
  const contentViewportTop =
    view.contentTop == null ? undefined : view.contentTop + windowOriginOffset;
  const contentViewportBottom =
    view.contentBottom == null ? undefined : view.contentBottom + windowOriginOffset;
  const vBubble = view.bubble;
  const vActions = view.actions;
  const menuItems: ActionMenuItem[] = vActions.map((action) => ({
    key: action.key,
    title: action.label,
    icon: action.icon,
    tone: action.destructive ? 'danger' : 'default',
    separatorBefore: action.destructive,
    onPress: action.onPress,
  }));
  const isSelf = vBubble.isSelf;
  const showReactionPill = !hideReactions && vBubble.renderBody == null;

  const menuMetrics = ACTION_MENU_METRICS[MENU_DENSITY];
  const menuH = actionMenuHeight(menuItems, MENU_DENSITY);
  const safeTop = insets.top + MARGIN;
  const safeBottom = H - insets.bottom - MARGIN;
  const safeLeft = insets.left + MARGIN;
  const safeRight = W - insets.right - MARGIN;

  const bubbleTop = vRect.y;
  const bubbleBottom = vRect.y + vRect.height;

  // The copy is NEVER moved — only clipped. `visibleTop`/`visibleBottom` are the
  // slice that's painted; the pill/menu take a side and the copy is clipped
  // further only when the gutters can't fit them.
  const touchPlacement = placeTouchMessageActionMenu({
    bubbleTop,
    bubbleBottom,
    contentTop: contentViewportTop ?? safeTop,
    contentBottom: contentViewportBottom ?? safeBottom,
    safeTop,
    safeBottom,
    pillHeight: PILL_H,
    menuHeight: menuH,
    showPill: showReactionPill,
    gap: GAP,
  });
  let { visibleTop, visibleBottom, pillTop, menuTop } = touchPlacement;

  // The painted slice + the offset that keeps the copy at its real position, and
  // the cut flags — an edge is faded when the bubble continues past the slice
  // (under the header/input, or clipped for pill/menu room).
  const copyTop = visibleTop;
  const copyH = Math.max(0, visibleBottom - visibleTop);
  const copyOffset = vRect.y - visibleTop; // ≤ 0 when the top is cut
  const fadeTop = bubbleTop < visibleTop;
  const fadeBottom = bubbleBottom > visibleBottom;
  const bodyFadeTop = vBodyRect.y < visibleTop;
  const bodyFadeBottom = vBodyRect.y + vBodyRect.height > visibleBottom;
  const clipped = fadeTop || fadeBottom;
  const fadeFrac = Math.min(0.5, FADE_H / Math.max(1, copyH));

  // Horizontal: align the cluster to the bubble's side, clamped to the margins.
  const leftFor = (w: number) => Math.max(MARGIN, Math.min(vRect.x, W - MARGIN - w));
  const rightFor = (w: number) =>
    Math.max(MARGIN, Math.min(W - (vRect.x + vRect.width), W - MARGIN - w));
  let menuSide: { left?: number; right?: number } = isSelf
    ? { right: rightFor(menuMetrics.width) }
    : { left: leftFor(menuMetrics.width) };
  let pillSide: { left?: number; right?: number } = isSelf
    ? { right: rightFor(0) }
    : { left: leftFor(0) };

  const pillChildCount = quickEmojis.length + 1; // reactions + more
  const pillW =
    REACTION_PILL_METRICS.paddingH * 2 +
    pillChildCount * REACTION_PILL_METRICS.buttonSize +
    (pillChildCount - 1) * REACTION_PILL_METRICS.gap +
    StyleSheet.hairlineWidth * 2;

  if (IS_ELECTRON && vRect.pointer) {
    const pointerPlacement = placeDesktopMessageActionMenu({
      anchor: vRect.pointer,
      safeLeft,
      safeRight,
      safeTop,
      safeBottom,
      menuWidth: menuMetrics.width,
      menuHeight: menuH,
      pillWidth: pillW,
      pillHeight: PILL_H,
      showPill: showReactionPill,
      gap: GAP,
      stackedGap: ELECTRON_PILL_MENU_STACKED_GAP,
    });
    menuTop = pointerPlacement.menuTop;
    pillTop = pointerPlacement.pillTop;
    menuSide = { left: pointerPlacement.menuLeft };
    pillSide = { left: pointerPlacement.pillLeft };
  }

  if (IS_ELECTRON) {
    const inflate = (x: number, y: number, w: number, h: number): HoverRect => ({
      left: x - ELECTRON_HOVER_SLACK,
      top: y - ELECTRON_HOVER_SLACK,
      right: x + w + ELECTRON_HOVER_SLACK,
      bottom: y + h + ELECTRON_HOVER_SLACK,
    });
    const rects = [inflate(vRect.x, vRect.y, vRect.width, vRect.height)];
    if (showReactionPill) {
      const pillLeft = pillSide.left ?? W - (pillSide.right ?? MARGIN) - pillW;
      rects.push(inflate(pillLeft, pillTop, pillW, PILL_H));
    }
    const menuLeft = menuSide.left ?? W - (menuSide.right ?? MARGIN) - menuMetrics.width;
    rects.push(inflate(menuLeft, menuTop, menuMetrics.width, menuH));
    hoverRectsRef.current = rects;
  }

  // The pill/menu pop in (0.2→1), drifting off the bubble's edge (pill from
  // below, menu from above) as they scale up, slightly staggered behind it.
  const popOpacity = progress.interpolate({
    inputRange: [0.2, 1],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const popScale = progress.interpolate({
    inputRange: [0.2, 1],
    outputRange: [0.8, 1],
    extrapolate: 'clamp',
  });
  const pillShift = progress.interpolate({
    inputRange: [0.2, 1],
    outputRange: [12, 0],
    extrapolate: 'clamp',
  });
  const menuShift = progress.interpolate({
    inputRange: [0.2, 1],
    outputRange: [-12, 0],
    extrapolate: 'clamp',
  });

  function renderLiftedMessage() {
    if (vBubble.renderBody) return vBubble.renderBody;
    return (
      <View style={{ width: vRect.width, minWidth: 0 }}>
        <View
          style={{
            alignSelf: vBubble.isSelf ? 'flex-end' : 'flex-start',
            maxWidth: '100%',
            minWidth: 0,
          }}
        >
          <BubbleBody
            content={vBubble.content}
            tags={vBubble.tags}
            isSelf={vBubble.isSelf}
            createdAt={vBubble.createdAt}
            rumorId={vBubble.rumorId}
            persistedDelivery={vBubble.persistedDelivery}
            replyTo={vBubble.replyTo}
            attachment={vBubble.attachment}
            remoteContentMode={vBubble.remoteContentMode}
            liftedCopy
            hideMeta={bodyFadeBottom}
            squareTop={bodyFadeTop}
            squareBottom={bodyFadeBottom}
          />
        </View>
        <ReactionsRow
          reactions={vBubble.reactions ?? []}
          isSelfBubble={vBubble.isSelf}
          onTapReaction={() => {}}
        />
      </View>
    );
  }

  const overlayContent = (
    <>
      {/* Electron keeps this layer visually transparent but still uses it to
          dismiss the menu when the user clicks outside its floating surfaces. */}
      <Animated.View style={{ flex: 1, opacity: IS_ELECTRON ? 1 : progress }}>
        {!IS_ELECTRON && Platform.OS === 'ios' ? (
          <BlurView
            intensity={32}
            tint={scheme === 'dark' ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        {/* A faint scrim over the blur for focus/depth (iOS context menus dim a
            touch on top of the blur). Doubles as a fallback dim if the native
            blur module isn't in the build yet. */}
        <Pressable
          accessible={false}
          tabIndex={-1}
          style={[
            StyleSheet.absoluteFill,
            IS_ELECTRON && { outlineWidth: 0 },
            !IS_ELECTRON && {
              backgroundColor:
                Platform.OS === 'android'
                  ? c.overlayStrong
                  : scheme === 'dark'
                    ? 'rgba(0,0,0,0.28)'
                    : 'rgba(0,0,0,0.08)',
            },
          ]}
          onPress={onClose}
        />
      </Animated.View>

      {/* Foreground cluster. pointerEvents box-none lets backdrop taps through
          everywhere except the pill/menu. */}
      <View
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'box-none' }}
      >
        {/* The transparent Modal sits above the source message. Mirror its exact
            measured rect so a click on the source message dismisses the menu —
            hover dismissal is handled by the window-level union hit-test. */}
        {IS_ELECTRON ? (
          <Pressable
            accessible={false}
            tabIndex={-1}
            onPress={onClose}
            style={{
              position: 'absolute',
              top: vRect.y,
              left: vRect.x,
              width: vRect.width,
              height: vRect.height,
              outlineWidth: 0,
            }}
          />
        ) : null}

        {/* Reaction pill — failed local uploads have no published rumor to react to. */}
        {showReactionPill ? (
          <Animated.View
            style={{
              position: 'absolute',
              top: pillTop,
              ...pillSide,
              flexDirection: 'row',
              alignItems: 'center',
              gap: REACTION_PILL_METRICS.gap,
              backgroundColor: c.surfaceElevated,
              borderRadius: radius.full,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: c.border,
              paddingHorizontal: REACTION_PILL_METRICS.paddingH,
              paddingVertical: REACTION_PILL_METRICS.paddingV,
              opacity: IS_ELECTRON ? 1 : popOpacity,
              transform: IS_ELECTRON
                ? undefined
                : [{ translateY: pillShift }, { scale: popScale }],
              ...shadow.float,
            }}
          >
            {quickEmojis.map((reaction) => {
              const reactionId = quickReactionKey(reaction);
              const active = reactedReactionKeys.includes(reactionId);
              return (
                <ReactionPillButton
                  key={reactionId}
                  accessibilityLabel={quickReactionLabel(reaction)}
                  onPress={() => onReact(reaction)}
                  active={active}
                >
                  {typeof reaction === 'string' ? (
                    <AppText style={REACTION_PILL_METRICS.unicodeStyle}>{reaction}</AppText>
                  ) : (
                    <CustomEmojiImage
                      emoji={reaction}
                      size={REACTION_PILL_METRICS.visualSize}
                      clickable={false}
                    />
                  )}
                </ReactionPillButton>
              );
            })}
            <ReactionPillButton
              measureAnchorOnPress={IS_ELECTRON}
              onPress={onMore}
            >
              <MoreHorizontal
                size={REACTION_PILL_METRICS.moreIconSize}
                color={c.textMuted}
              />
            </ReactionPillButton>
          </Animated.View>
        ) : null}

        {/* Lifted bubble — static and opaque, sitting *exactly* over the real
            bubble (it never moves), so the two are pixel-aligned and never read
            as a duplicate. Non-interactive, so a tap on it dismisses. When it's
            too tall to fit, it stays put but is clipped to the window the pill /
            menu leave and its cut edge(s) dissolve into the blurred backdrop — a
            hard cut would read as a weird truncated whole bubble. */}
        {!IS_ELECTRON ? (
          clipped ? (
            <View
              style={{
                position: 'absolute',
                top: copyTop,
                left: vRect.x,
                width: vRect.width,
                height: copyH,
                pointerEvents: 'none',
              }}
            >
              <MaskedView
                style={{ flex: 1 }}
                maskElement={
                  <Svg width={vRect.width} height={copyH}>
                    <Defs>
                      <LinearGradient id="liftFade" x1="0" y1="0" x2="0" y2="1">
                        {/* Dissolve only at an edge that's actually cut. */}
                        <Stop offset="0" stopColor="#fff" stopOpacity={fadeTop ? 0 : 1} />
                        <Stop offset={fadeFrac} stopColor="#fff" stopOpacity={1} />
                        <Stop offset={1 - fadeFrac} stopColor="#fff" stopOpacity={1} />
                        <Stop offset="1" stopColor="#fff" stopOpacity={fadeBottom ? 0 : 1} />
                      </LinearGradient>
                    </Defs>
                    <Rect
                      x="0"
                      y="0"
                      width={vRect.width}
                      height={copyH}
                      fill="url(#liftFade)"
                    />
                  </Svg>
                }
              >
                {/* Offset so the copy paints at the real bubble's position; the
                    mask clips the part outside the window. */}
                <View style={{ marginTop: copyOffset }}>
                  {renderLiftedMessage()}
                </View>
              </MaskedView>
            </View>
          ) : (
            <View
              style={{
                position: 'absolute',
                top: copyTop,
                left: vRect.x,
                width: vRect.width,
                pointerEvents: 'none',
              }}
            >
              {renderLiftedMessage()}
            </View>
          )
        ) : null}

        {/* Action menu */}
        <Animated.View
          style={{
            position: 'absolute',
            top: menuTop,
            ...menuSide,
            opacity: IS_ELECTRON ? 1 : popOpacity,
            transform: IS_ELECTRON
              ? undefined
              : [{ translateY: menuShift }, { scale: popScale }],
          }}
        >
          <ActionMenuPanel density={MENU_DENSITY} items={menuItems} />
        </Animated.View>
      </View>
    </>
  );

  // A native Modal resigns the composer's first responder. When the software
  // keyboard was already open, use the keyboard controller's overlay host: the
  // input stays focused, the keyboard remains in place under the backdrop, and
  // the menu may use the full safe area, including the keyboard's screen region.
  if (!IS_ELECTRON && view.preserveKeyboard) {
    return (
      <OverKeyboardView visible>
        <View style={{ flex: 1 }}>{overlayContent}</View>
      </OverKeyboardView>
    );
  }

  return (
    <Modal visible transparent statusBarTranslucent onRequestClose={onClose}>
      {overlayContent}
    </Modal>
  );
}
