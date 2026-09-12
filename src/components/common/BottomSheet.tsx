import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type FlatListProps,
  Modal,
  type StyleProp,
  StyleSheet,
  type TextInput,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IS_ELECTRON } from '@/lib/platform';
import { contentWidth, radius, spacing, useThemeColors } from '@/theme';

import { scheduleBottomSheetInputFocus } from './bottom-sheet-input-focus';
import { scheduleBottomSheetOpenAnimation } from './bottom-sheet-open-animation';
import { SheetHeader } from './SheetHeader';

type Props<ItemT = never> = {
  visible: boolean;
  onClose: () => void;
  /** Input to focus after the native Modal becomes keyboard-ready. */
  inputFocusRef?: RefObject<TextInput | null>;
  /** Refocus `inputFocusRef` when an already-open sheet enters a new input step. */
  inputFocusKey?: string | number | null;
  /** Fired once the exit animation finishes and the sheet has unmounted. Use
   * this to launch another modal (e.g. the image picker) so two native modals
   * don't fight during the transition. */
  onClosed?: () => void;
  /** Show the drag grabber handle. Default true. */
  showHandle?: boolean;
  /** Optional card width cap for a deliberately compact sheet. Defaults to the
   * app-wide sheet width and still shrinks to the phone viewport. */
  maxWidth?: number;
  /** Task/detail title. When present, BottomSheet renders the standard fixed
   * close/title/action header below the grabber. Omit only for a short,
   * self-explanatory action sheet. */
  title?: string;
  /** One optional IconButton using the standard title-bar action sizing. */
  headerAction?: ReactNode;
  /** Optional non-scrolling business content below the standard header. It
   * receives the same ungated pull-to-dismiss gesture as the grabber. */
  fixedSubheader?: ReactNode;
  /** Optional non-scrolling content below the body. BottomSheet owns its
   * horizontal padding and bottom safe-area inset. */
  fixedFooter?: ReactNode;
  /** Merged onto the body ScrollView viewport. Use this to give a bounded
   * scrolling preview a fixed height. */
  scrollStyle?: StyleProp<ViewStyle>;
  /** Fixed decoration painted above the body ScrollView, such as EdgeFade. */
  scrollOverlay?: ReactNode;
  /** Reset the shared body offset when one mounted sheet replaces its body with
   * another step (for example recipient picker -> confirmation preview). */
  scrollResetKey?: string | number;
  /** Full-screen content painted above this sheet inside the same native Modal.
   * Use for an immersive child surface that must close back to this sheet. */
  modalOverlay?: ReactNode;
  /** Merged onto the scrollable content container. Use it when this sheet's
   * direct content blocks need an explicit gap or additional padding. */
  contentStyle?: StyleProp<ViewStyle>;
  /** Render the body as a virtualized list while retaining the sheet's shared
   * UI-thread scroll/pull-down coordination. Use this for unbounded pickers;
   * ordinary short or preview bodies should keep using `children`. */
  listProps?: Omit<
    FlatListProps<ItemT>,
    | 'CellRendererComponent'
    | 'bounces'
    | 'contentContainerStyle'
    | 'onContentSizeChange'
    | 'onLayout'
    | 'onScroll'
    | 'scrollEnabled'
    | 'scrollEventThrottle'
    | 'showsVerticalScrollIndicator'
  > & {
    contentContainerStyle?: FlatListProps<ItemT>['contentContainerStyle'];
  };
  children?: ReactNode;
};

const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 800;
const OPEN_MS = 280;
const CLOSE_MS = 280;
// When the keyboard rises under the sheet, tuck the card this far *behind* the
// keyboard's top edge so its flat bottom slides under the keyboard's rounded top
// corners (the keyboard is rounded, the card is square) — keeps the visible
// bottom-padding strip tight while leaving the content above the keyboard.
const KEYBOARD_TUCK = 16;
// A same-colour panel hanging just below the card that fills the area behind the
// keyboard once the card lifts, so the rounded corners are always backed by the
// sheet colour no matter their radius (the tuck alone can fall a hair short).
const KEYBOARD_SKIRT = 48;

// On the Electron (web) renderer a sheet that opens while a pointer is still
// held — summoned by a long-press or a right-click — receives the release's
// synthesized click on whatever row now sits under the pointer, reading as a
// spurious activation (the account switcher's Add row "clicked" itself when the
// long-press on the Me tab was released). Track held pointers globally so the
// open effect can swallow that one release click (see below).
const heldPointers = new Set<number>();
if (IS_ELECTRON) {
  const release = (e: PointerEvent) => heldPointers.delete(e.pointerId);
  window.addEventListener('pointerdown', (e) => heldPointers.add(e.pointerId), true);
  window.addEventListener('pointerup', release, true);
  window.addEventListener('pointercancel', release, true);
}

/**
 * Bottom sheet built on RN Modal. The backdrop fades in place while the card
 * slides up from the bottom; it dismisses by dragging the **grabber** down,
 * tapping the backdrop, or (when at the content's top) pulling the content down.
 *
 * **Capped at the screen height** — content lives in a `ScrollView` whose scroll
 * is enabled only when it actually overflows (measured), so short sheets behave
 * like a plain card. The drag and the scroll are coordinated on the **UI thread**
 * via reanimated worklets + a shared scroll offset: the *content* pan follows the
 * finger (and dismisses past a threshold) only while the content is at its top,
 * otherwise the content scrolls. Running this on the UI thread (not JS callbacks)
 * is what keeps the two gestures from wedging the touch system.
 *
 * **The grabber and fixed chrome regions have their own *ungated* dismiss
 * pans** — a downward drag there always closes the sheet, no matter the body
 * scroll offset. This is the reliable "pull fixed chrome down to close"
 * affordance for a sheet whose body scrolls or is wall-to-wall `Pressable` rows.
 * The body remains the sheet's single coordinated vertical ScrollView, so fixed
 * chrome never creates a nested-scroll gesture race.
 */
export function BottomSheet<ItemT = never>({
  visible,
  onClose,
  inputFocusRef,
  inputFocusKey,
  onClosed,
  showHandle = true,
  maxWidth = contentWidth.sheet,
  title,
  headerAction,
  fixedSubheader,
  fixedFooter,
  scrollStyle,
  scrollOverlay,
  scrollResetKey,
  modalOverlay,
  contentStyle,
  listProps,
  children,
}: Props<ItemT>) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const c = useThemeColors();
  const [mounted, setMounted] = useState(visible);
  const [dragClosing, setDragClosing] = useState(false);
  const modalPresentedRef = useRef(false);
  const cancelInputFocusRef = useRef<(() => void) | null>(null);
  const cancelOpenAnimationRef = useRef<(() => void) | null>(null);
  const translateY = useSharedValue(height);
  const backdrop = useSharedValue(0);
  const scrollY = useSharedValue(0);
  // Keyboard movement on the reanimated timeline (`height` 0 → -keyboardHeight,
  // `progress` 0 → 1) so the card rides above a keyboard raised by a field inside
  // it — on the UI thread (smoother than RN's `KeyboardAvoidingView`), and so we
  // can also tuck it behind the keyboard's rounded top (see KEYBOARD_TUCK).
  const kb = useReanimatedKeyboardAnimation();

  const cancelInputFocus = useCallback(() => {
    cancelInputFocusRef.current?.();
    cancelInputFocusRef.current = null;
  }, []);
  const scheduleInputFocus = useCallback(() => {
    cancelInputFocus();
    if (inputFocusRef) {
      cancelInputFocusRef.current = scheduleBottomSheetInputFocus(inputFocusRef);
    }
  }, [cancelInputFocus, inputFocusRef]);

  const cancelOpenAnimation = useCallback(() => {
    cancelOpenAnimationRef.current?.();
    cancelOpenAnimationRef.current = null;
  }, []);
  const scheduleOpenAnimation = useCallback(() => {
    cancelOpenAnimation();
    cancelOpenAnimationRef.current = scheduleBottomSheetOpenAnimation(() => {
      cancelOpenAnimationRef.current = null;
      translateY.value = withTiming(0, {
        duration: OPEN_MS,
        easing: Easing.out(Easing.cubic),
      });
      backdrop.value = withTiming(1, {
        duration: OPEN_MS,
        easing: Easing.out(Easing.cubic),
      });
    });
  }, [backdrop, cancelOpenAnimation, translateY]);
  const handleModalShow = useCallback(() => {
    modalPresentedRef.current = true;
    if (!visible) return;
    scheduleOpenAnimation();
    scheduleInputFocus();
  }, [scheduleInputFocus, scheduleOpenAnimation, visible]);

  useEffect(() => {
    if (visible) return;
    cancelOpenAnimation();
    cancelInputFocus();
  }, [cancelInputFocus, cancelOpenAnimation, visible]);

  useEffect(() => {
    if (!visible || !modalPresentedRef.current || inputFocusRef == null) return;
    scheduleInputFocus();
    return cancelInputFocus;
  }, [cancelInputFocus, inputFocusKey, inputFocusRef, scheduleInputFocus, visible]);

  useEffect(
    () => () => {
      cancelInputFocus();
      cancelOpenAnimation();
    },
    [cancelInputFocus, cancelOpenAnimation],
  );
  // A drag-committed close owns its UI-thread animation. The parent still flips
  // `visible` immediately, but that state change must not replace the in-flight
  // animation with a fresh timing after a JS round trip.
  const finishClose = useCallback(() => {
    setMounted(false);
    setDragClosing(false);
    onClosed?.();
  }, [onClosed]);
  const beginDragClose = useCallback(() => {
    setDragClosing(true);
    onClose();
  }, [onClose]);

  // Enable inner scrolling only when the content overflows the capped card.
  const [scrollEnabled, setScrollEnabled] = useState(false);
  const viewportH = useRef(0);
  const contentH = useRef(0);
  const recomputeScroll = () => {
    const next = contentH.current > viewportH.current + 1;
    setScrollEnabled((prev) => (prev === next ? prev : next));
  };

  const scrollHandler = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability -- Reanimated shared values are mutable.
    scrollY.value = 0;
  }, [scrollResetKey, scrollY]);

  // Drag-to-dismiss in two flavours so a downward pull always closes the sheet —
  // even when the body scrolls or is wall-to-wall Pressables with no bare drag zone:
  //   • fixed-region pans — *ungated* pans on the grabber, sheet header,
  //     subheader, and footer. A downward drag there always follows the finger
  //     and dismisses past the threshold, regardless of the body scroll offset.
  //   • the content pan — coordinated with the ScrollView's native gesture (both run
  //     *simultaneously*): moves the card only while the content is at its top
  //     (scrollY <= 0) and the drag is downward, otherwise the content scrolls.
  // Coordinating on the UI thread (not JS callbacks) is what stops the two from
  // wedging the touch system.
  const {
    grabberPan,
    sheetHeaderPan,
    fixedSubheaderPan,
    fixedFooterPan,
    listGesture,
  } = useMemo(() => {
    const settleBack = () => {
      'worklet';
      translateY.value = withTiming(0, { duration: 180, easing: Easing.out(Easing.cubic) });
    };
    const dismissFromDrag = () => {
      'worklet';
      // Keep moving on the UI thread from the finger's release position. The
      // ease-out starts immediately; the parent state update only changes the
      // declarative visibility and does not re-drive this visual close.
      // eslint-disable-next-line react-hooks/immutability -- Reanimated values are mutable in worklets.
      backdrop.value = withTiming(0, {
        duration: CLOSE_MS,
        easing: Easing.out(Easing.cubic),
      });
      // eslint-disable-next-line react-hooks/immutability -- Reanimated values are mutable in worklets.
      translateY.value = withTiming(
        height,
        { duration: CLOSE_MS, easing: Easing.out(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(finishClose)();
        },
      );
      runOnJS(beginDragClose)();
    };
    // Ungated: a downward drag always follows the finger and dismisses past the
    // threshold, regardless of scroll offset. Each detector needs its own gesture
    // instance because one gesture object can only attach to one GestureDetector.
    const makeUngated = () =>
      Gesture.Pan()
        .activeOffsetY(10)
        .onUpdate((e) => {
          'worklet';
          if (e.translationY > 0) translateY.value = e.translationY;
        })
        .onEnd((e) => {
          'worklet';
          if (e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY)
            dismissFromDrag();
          else settleBack();
        });
    const native = Gesture.Native();
    const content = Gesture.Pan()
      .activeOffsetY(10)
      .simultaneousWithExternalGesture(native)
      .onUpdate((e) => {
        'worklet';
        if (scrollY.value <= 0 && e.translationY > 0) translateY.value = e.translationY;
      })
      .onEnd((e) => {
        'worklet';
        const atTop = scrollY.value <= 0;
        if (atTop && (e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY)) {
          dismissFromDrag();
        } else {
          settleBack();
        }
      });
    native.simultaneousWithExternalGesture(content);
    return {
      grabberPan: makeUngated(),
      sheetHeaderPan: makeUngated(),
      fixedSubheaderPan: makeUngated(),
      fixedFooterPan: makeUngated(),
      listGesture: Gesture.Simultaneous(content, native),
    };
  }, [backdrop, beginDragClose, finishClose, height, scrollY, translateY]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      if (dragClosing) setDragClosing(false);
      // A newly mounted body starts at offset zero; keep the UI-thread gate in
      // sync even when the previous instance closed while scrolled.
      // eslint-disable-next-line react-hooks/immutability -- Reanimated shared values are mutable.
      scrollY.value = 0;
      if (modalPresentedRef.current) {
        // Reopening during an interrupted close keeps the existing native Modal;
        // reverse smoothly from its current position because onShow will not fire.
        scheduleOpenAnimation();
      } else {
        // A fresh Modal mounts fully off-screen. Its onShow callback starts the
        // transition on the following frame, after native presentation + layout.
        // eslint-disable-next-line react-hooks/immutability -- Reanimated shared values are mutable.
        translateY.value = height;
        // eslint-disable-next-line react-hooks/immutability -- Reanimated shared values are mutable.
        backdrop.value = 0;
      }
    } else {
      cancelOpenAnimation();
      // The drag worklet already scheduled a continuous close before notifying
      // React. Let that animation finish instead of restarting it here.
      if (dragClosing) return;
      backdrop.value = withTiming(0, { duration: CLOSE_MS, easing: Easing.out(Easing.cubic) });
      translateY.value = withTiming(
        height,
        { duration: CLOSE_MS, easing: Easing.out(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(finishClose)();
        },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!mounted) modalPresentedRef.current = false;
  }, [mounted]);

  // Electron only: when the sheet opens while a pointer is still held (it was
  // summoned by a long-press or right-click), swallow the release's click /
  // auxclick / contextmenu so it can't activate whatever row now sits under the
  // pointer. Window-capture listeners fire before React's root-container
  // delegation, so the swallowed event never reaches any handler. Sheets opened
  // by an ordinary tap (pointer already released) arm nothing.
  useEffect(() => {
    if (!IS_ELECTRON || !visible || heldPointers.size === 0) return;

    function swallow(e: Event) {
      e.preventDefault();
      e.stopPropagation();
    }
    function disarm() {
      window.removeEventListener('click', swallow, true);
      window.removeEventListener('auxclick', swallow, true);
      window.removeEventListener('contextmenu', swallow, true);
      window.removeEventListener('pointerup', onRelease, true);
      window.removeEventListener('pointercancel', onRelease, true);
      window.removeEventListener('blur', onRelease, true);
    }
    function onRelease() {
      // The release's click/auxclick is dispatched right after pointerup, so
      // keep swallowing through this task before disarming.
      setTimeout(disarm, 0);
    }

    window.addEventListener('click', swallow, true);
    window.addEventListener('auxclick', swallow, true);
    window.addEventListener('contextmenu', swallow, true);
    window.addEventListener('pointerup', onRelease, true);
    window.addEventListener('pointercancel', onRelease, true);
    window.addEventListener('blur', onRelease, true);

    return disarm;
  }, [visible]);

  // Slide/drag offset, plus the keyboard: lift by its height, then sink back
  // `KEYBOARD_TUCK` so the card's bottom slides *under* the keyboard's rounded
  // top corners (filling behind them) rather than meeting them with a flat seam.
  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value + kb.height.value + kb.progress.value * KEYBOARD_TUCK },
    ],
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));

  if (!mounted) return null;

  // Never let the card exceed the screen: cap it just below the top safe area.
  const maxCardHeight = height - insets.top - 12;
  const grabberPaddingTop = title != null ? spacing.sm : spacing.md;
  const grabberPaddingBottom = title != null ? 0 : spacing.lg;
  const grabberHeight = grabberPaddingTop + spacing.xs + grabberPaddingBottom;
  const maxScrollHeight = maxCardHeight - (showHandle ? grabberHeight : 0);

  const sharedScrollProps = {
    scrollEnabled,
    onLayout: (e: Parameters<NonNullable<FlatListProps<ItemT>['onLayout']>>[0]) => {
      viewportH.current = e.nativeEvent.layout.height;
      recomputeScroll();
    },
    onContentSizeChange: (_w: number, h: number) => {
      contentH.current = h;
      recomputeScroll();
    },
    onScroll: scrollHandler,
    scrollEventThrottle: 16,
    bounces: false,
    showsVerticalScrollIndicator: false,
  } as const;

  const bodyScrollView = listProps ? (
    <GestureDetector gesture={listGesture}>
      <Animated.FlatList
        key={scrollResetKey}
        {...listProps}
        style={[
          { flexShrink: 1, maxHeight: maxScrollHeight },
          scrollStyle,
          listProps.style,
        ]}
        contentContainerStyle={[contentStyle, listProps.contentContainerStyle]}
        keyboardShouldPersistTaps={listProps.keyboardShouldPersistTaps ?? 'handled'}
        {...sharedScrollProps}
      />
    </GestureDetector>
  ) : (
    <GestureDetector gesture={listGesture}>
      <Animated.ScrollView
        key={scrollResetKey}
        // Wrap short content and cap overflowing content even when an overlay
        // wrapper owns the viewport. `flex: 1` would collapse when that wrapper
        // has only a max height and no fixed height.
        style={[{ flexShrink: 1, maxHeight: maxScrollHeight }, scrollStyle]}
        contentContainerStyle={[
          {
            paddingHorizontal: 16,
            paddingTop:
              showHandle || title != null || fixedSubheader != null ? 0 : spacing.xl,
            paddingBottom: fixedFooter == null ? Math.max(insets.bottom, 24) : 0,
          },
          contentStyle,
        ]}
        {...sharedScrollProps}
        // No rubber-band: the pan drives the pull-down-to-dismiss (card follows
        // the finger) when at the top, so the content must not also bounce.
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </Animated.ScrollView>
    </GestureDetector>
  );

  const body = scrollOverlay ? (
    <View
      style={[
        { position: 'relative', flexShrink: 1, maxHeight: maxScrollHeight },
        scrollStyle,
      ]}
    >
      {bodyScrollView}
      {scrollOverlay}
    </View>
  ) : (
    bodyScrollView
  );

  const card = (
    <View
      style={{
        backgroundColor: c.sheetBackground,
        borderTopLeftRadius: radius['2xl'],
        borderTopRightRadius: radius['2xl'],
        maxHeight: maxCardHeight,
        overflow: 'hidden',
      }}
    >
      {showHandle ? (
        // A task header provides its own drag zone, so its grabber needs only a
        // compact top inset. Handle-only sheets retain the larger drag target.
        <GestureDetector gesture={grabberPan}>
          <View
            style={{
              paddingTop: grabberPaddingTop,
              paddingBottom: grabberPaddingBottom,
              alignItems: 'center',
            }}
          >
            <View
              style={{
                width: 36,
                height: spacing.xs,
                borderRadius: radius.sm,
                backgroundColor: c.border,
              }}
            />
          </View>
        </GestureDetector>
      ) : null}
      {title != null ? (
        <GestureDetector gesture={sheetHeaderPan}>
          <View>
            <SheetHeader title={title} onClose={onClose} action={headerAction} />
          </View>
        </GestureDetector>
      ) : null}
      {fixedSubheader != null ? (
        <GestureDetector gesture={fixedSubheaderPan}>
          <View
            style={{
              paddingHorizontal: spacing.lg,
              paddingTop: showHandle || title != null ? 0 : spacing.xl,
              paddingBottom: spacing.sm,
            }}
          >
            {fixedSubheader}
          </View>
        </GestureDetector>
      ) : null}
      {body}
      {fixedFooter != null ? (
        <GestureDetector gesture={fixedFooterPan}>
          <View
            style={{
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.md,
              paddingBottom: Math.max(insets.bottom, spacing.lg),
            }}
          >
            {fixedFooter}
          </View>
        </GestureDetector>
      ) : null}
    </View>
  );

  return (
    <Modal
      visible
      transparent
      animationType="none"
      hardwareAccelerated
      statusBarTranslucent
      onRequestClose={onClose}
      onShow={handleModalShow}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        {/* The keyboard lift is handled on the reanimated timeline (cardStyle),
            not RN's KeyboardAvoidingView, so it can also tuck behind the keyboard. */}
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: c.sheetBackdrop },
              backdropStyle,
            ]}
          >
            <Pressable hoverFeedback={false} style={{ flex: 1 }} onPress={onClose} />
          </Animated.View>
          {/* No card-wide pan: drag-to-dismiss lives on the fixed regions and the
              body (listGesture), so a body full
              of Pressables can't swallow the pull-down. */}
          <Animated.View
            style={[
              {
                width: '100%',
                maxWidth,
                alignSelf: 'center',
              },
              cardStyle,
            ]}
          >
            {card}
            {/* Same-colour "skirt" hanging below the card. Off-screen at rest;
                once the card lifts for the keyboard it fills the area *behind*
                the keyboard — guaranteeing the rounded top corners are backed by
                the sheet colour whatever their radius, so no seam shows. */}
            <View
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                height: KEYBOARD_SKIRT,
                backgroundColor: c.sheetBackground,
                pointerEvents: 'none',
              }}
            />
          </Animated.View>
        </View>
        {modalOverlay}
      </GestureHandlerRootView>
    </Modal>
  );
}
