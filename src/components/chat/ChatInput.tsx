import { Keyboard as KeyboardIcon } from '@solar-icons/react-native/category/devices/Linear/Keyboard';
import { Plain3 as Send } from '@solar-icons/react-native/category/messages/Linear/Plain3';
import { Microphone as Mic } from '@solar-icons/react-native/category/video/Linear/Microphone';
import { SmileCircle as Smile } from '@solar-icons/react-native/category/faces/Linear/SmileCircle';
import {
  KeyboardController,
  useKeyboardHandler,
} from "react-native-keyboard-controller";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Keyboard,
  type NativeSyntheticEvent,
  StyleSheet,
  TextInput,
  type TextInputKeyPressEventData,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  ZoomIn,
  ZoomOut,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { IconButton } from "@/components/common/IconButton";
import { ChromeBackdrop } from "@/components/common/ChromeBackdrop";
import { InteractivePressable as Pressable } from "@/components/common/InteractivePressable";
import Plus from "lucide-react-native/icons/plus";
import { CustomEmojiImage } from "@/components/emoji/CustomEmojiImage";
import { useCustomEmojis } from "@/hooks/use-custom-emojis";
import { useElectronComposerEscape } from '@/hooks/use-electron-composer-escape';
import { useElectronComposerTypingFocus } from '@/hooks/use-electron-composer-typing-focus';
import { useDirectionalIconStyle, useIsRTL } from "@/i18n/direction";
import { classifyMessageSendFailure } from '@/lib/chat/message-send-error';
import { impact } from "@/lib/haptics";
import { getBottomChromeInset } from "@/lib/layout/bottom-chrome";
import { normalizeBareNostrUris } from "@/lib/nostr/normalize-content";
import type { CustomEmoji } from "@/lib/nostr/custom-emoji";
import {
  composerFilesFromClipboard,
  type ComposerFile,
} from '@/lib/attachments/composer-file';
import { DESKTOP_OS, IS_ELECTRON } from "@/lib/platform";
import {
  markChatComposerMounted,
  markChatInputFocus,
  markChatInputPress,
  markChatKeyboardEvent,
  markChatPanelCommit,
  markChatPanelRequest,
} from '@/lib/perf/chat-open';
import { useActiveAccount } from "@/stores/active-account.store";
import { useChatPrefsStore } from "@/stores/chat-prefs.store";
import { useDraftsStore } from "@/stores/drafts.store";
import { showToast } from '@/stores/toast.store';
import { iconStrokeWidth } from '@/theme/icons';
import {
  bottomBarHeight,
  emojiSize,
  radius,
  shadow,
  spacing,
  typography,
  uiDensity,
  useThemeColors,
} from "@/theme";

import {
  AttachmentPanel,
  attachmentPanelHeight,
  type AttachmentSource,
} from "./AttachmentPanel";
import { ComposerAttachmentMenu } from './ComposerAttachmentMenu';
import { useChatComposerPanel } from './chat-composer-panel-context';
import {
  interpolateComposerPanelToKeyboard,
  scheduleComposerPanelWorkAfterPaint,
} from './composer-panel-scheduling';
import { ComposerEmojiPickerPanel } from './ComposerEmojiPickerPanel';
import type { EmojiPickerPopoverAnchor } from './EmojiPickerSheet';
import { QuotedReply } from "./QuotedReply";
import { VoiceRecorderBar, type VoicePayload } from "./VoiceRecorderBar";
import { shouldSendOnDesktopKeyPress } from './desktop-send-shortcut';

const LazyEmojiPickerSheet = lazy(() =>
  import('./EmojiPickerSheet').then((module) => ({ default: module.EmojiPickerSheet })),
);

type Props = {
  /** Called with trimmed, non-empty message text. Relay mode also normalizes bare NIP-19 identifiers. */
  onSend: (text: string, customEmojis: CustomEmoji[]) => Promise<void> | void;
  /** Pick an attachment source from the inline tray; absent hides the `+`. */
  onPickAttachment?: (source: AttachmentSource) => void;
  /** Electron-only file payloads pasted into the text field. Ordinary text
   * paste continues through the browser's native TextInput behaviour. */
  onPasteFiles?: (files: ComposerFile[]) => void;
  /** Sources supported by this conversation transport. */
  attachmentSources?: readonly AttachmentSource[];
  /** Record + send a voice message; absent hides the mic. */
  onSendVoice?: (payload: VoicePayload) => void;
  /** Quote shown inside the input box while composing a reply (with a cancel
   * button); null when not replying. */
  replyTo?: { senderName: string; contentPreview: string } | null;
  onCancelReply?: () => void;
  /** Changes whenever an explicit reply action should restore input focus. */
  focusRequestVersion?: number;
  disabled?: boolean;
  /** Conversation key this composer drafts for. The unsent text is persisted
   * under it (so the conversation list shows a "Draft" preview and it survives
   * leaving / restarting) and seeded back when the chat reopens. */
  draftKey?: string;
  /** Delay collection subscription/local cache reads until the route transition
   * finishes while still rendering a fully interactive text field immediately. */
  liveDataEnabled?: boolean;
};

type ComposerPanelMode = 'attachments' | 'emoji';

type DesktopTextInputKeyEvent = NativeSyntheticEvent<TextInputKeyPressEventData> & {
  key?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  repeat?: boolean;
  keyCode?: number;
  nativeEvent: TextInputKeyPressEventData & {
    metaKey?: boolean;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    isComposing?: boolean;
    repeat?: boolean;
    keyCode?: number;
  };
};

// The text field auto-grows from one line up to this many lines, then scrolls.
const INPUT_LINE_HEIGHT = typography.body.lineHeight;
const INPUT_MAX_HEIGHT = INPUT_LINE_HEIGHT * 5;
// Extra room the box needs when the reply quote sits above the text field
// (two caption lines + the quote↔field gap).
const REPLY_BLOCK_HEIGHT = 48;
const COMPOSER_PANEL_MIN_HEIGHT = 330;
const COMPOSER_PANEL_MAX_HEIGHT = 350;
const COMPOSER_PANEL_SCREEN_RATIO = 0.385;
const COMPOSER_ACTION_SIZE = uiDensity.composerActionSize;
const INPUT_ACTION_SIZE = spacing['2xl'];
const INPUT_ACTION_INSET = spacing.xs;
const INPUT_CONTENT_INSET = 14;
const INPUT_ACTION_GAP = spacing.sm;
const INPUT_ACTION_RESERVE =
  INPUT_ACTION_INSET + INPUT_ACTION_SIZE + INPUT_ACTION_GAP - INPUT_CONTENT_INSET;

// Shortcode suggestions above the field: the whole draft must stay a short,
// single token (no whitespace) to keep matching, and only the first few
// matches are offered.
const SUGGESTION_DEBOUNCE_MS = 200;
const SUGGESTION_MAX_CHARS = 5;
const SUGGESTION_LIMIT = 4;
// The suggestion strip floats over the message list: its fixed height is
// folded back into the composer's negative top margin, so it appears above
// the input bar without ever reflowing the list (and stays inside the
// composer's bounds, which Android touch dispatch requires). The height is
// the card (artwork + cell and card padding) plus the air below it.
const SUGGESTION_STRIP_HEIGHT =
  emojiSize.composerSuggestionImage + spacing.xs * 5;
const COMPOSER_PANEL_EASE = Easing.out(Easing.cubic);

export function ChatInput({
  onSend,
  onPickAttachment,
  onPasteFiles,
  attachmentSources = [],
  onSendVoice,
  replyTo,
  onCancelReply,
  focusRequestVersion,
  disabled,
  draftKey,
  liveDataEnabled = true,
}: Props) {
  const { t } = useTranslation();
  const directionalIconStyle = useDirectionalIconStyle();
  const isRTL = useIsRTL();
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const [panelWidth, setPanelWidth] = useState(screenWidth);
  // Track every native keyboard-move event ourselves. The provider-level shared
  // values jump to the target at keyboard-start on iOS; per-frame handler values
  // preserve the real transition needed for a seamless panel handoff.
  const keyboardHeight = useSharedValue(0);
  const keyboardProgress = useSharedValue(0);
  useKeyboardHandler(
    {
      onMove: (event) => {
        'worklet';
        keyboardHeight.value = event.height;
        keyboardProgress.value = event.progress;
      },
      onInteractive: (event) => {
        'worklet';
        keyboardHeight.value = event.height;
        keyboardProgress.value = event.progress;
      },
      onEnd: (event) => {
        'worklet';
        keyboardHeight.value = event.height;
        keyboardProgress.value = event.progress;
      },
    },
    [],
  );
  const inputRef = useRef<TextInput>(null);
  const detachPasteListenerRef = useRef<(() => void) | null>(null);
  const attachmentButtonRef = useRef<View>(null);
  const emojiButtonRef = useRef<View>(null);
  const [desktopAttachmentAnchor, setDesktopAttachmentAnchor] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [desktopEmojiAnchor, setDesktopEmojiAnchor] =
    useState<EmojiPickerPopoverAnchor | null>(null);
  const [desktopEmojiMounted, setDesktopEmojiMounted] = useState(false);
  const [desktopEmojiVisible, setDesktopEmojiVisible] = useState(false);
  const pasteFilesRef = useRef(onPasteFiles);
  pasteFilesRef.current = onPasteFiles;
  const accountPubkey = useActiveAccount((state) => state.activePubkey);
  const emojiCollection = useCustomEmojis(accountPubkey, liveDataEnabled);
  const customEmojiByShortcode = useMemo(() => {
    const map = new Map<string, CustomEmoji>();
    for (const emoji of emojiCollection.standalone) {
      if (!map.has(emoji.shortcode.toLowerCase())) map.set(emoji.shortcode.toLowerCase(), emoji);
    }
    for (const pack of emojiCollection.packs) {
      for (const emoji of pack.emojis) {
        if (!map.has(emoji.shortcode.toLowerCase())) map.set(emoji.shortcode.toLowerCase(), emoji);
      }
    }
    return map;
  }, [emojiCollection.packs, emojiCollection.standalone]);
  // Seed from the persisted draft for this conversation (once, at mount). Drafts
  // are loaded into the store at startup, so they're ready by the time a chat
  // opens. The value stays local (keystrokes don't re-render the list); the
  // store is written separately below.
  const [value, setValue] = useState(
    () => (draftKey ? (useDraftsStore.getState().drafts[draftKey] ?? "") : ""),
  );
  const valueRef = useRef(value);
  valueRef.current = value;
  const [sending, setSending] = useState(false);
  useLayoutEffect(() => {
    if (draftKey) markChatComposerMounted(draftKey);
  }, [draftKey]);
  useEffect(() => {
    if (!draftKey) return;
    const willShow = Keyboard.addListener('keyboardWillShow', () =>
      markChatKeyboardEvent(draftKey, 'willShow'),
    );
    const didShow = Keyboard.addListener('keyboardDidShow', () =>
      markChatKeyboardEvent(draftKey, 'didShow'),
    );
    return () => {
      willShow.remove();
      didShow.remove();
    };
  }, [draftKey]);
  // Draft actions are stable (zustand) — referencing them doesn't re-render here.
  const setDraft = useDraftsStore((s) => s.setDraft);
  const clearDraft = useDraftsStore((s) => s.clearDraft);
  const flushDraft = useDraftsStore((s) => s.flush);
  // Persist the latest draft when leaving the chat (composer unmount), bypassing
  // the store's debounce so navigating away never drops the last keystrokes.
  useEffect(() => {
    if (!draftKey) return;
    return () => flushDraft(draftKey);
  }, [draftKey, flushDraft]);
  useEffect(
    () => () => {
      detachPasteListenerRef.current?.();
    },
    [],
  );

  const setInputRef = useCallback((node: TextInput | null) => {
    detachPasteListenerRef.current?.();
    detachPasteListenerRef.current = null;
    inputRef.current = node;
    if (!IS_ELECTRON || !node) return;

    const target = node as unknown as {
      addEventListener?: (type: 'paste', listener: (event: Event) => void) => void;
      removeEventListener?: (type: 'paste', listener: (event: Event) => void) => void;
    };
    if (!target.addEventListener || !target.removeEventListener) return;

    const handlePaste = (event: Event) => {
      const files = composerFilesFromClipboard(event);
      if (files.length === 0 || !pasteFilesRef.current) return;
      event.preventDefault();
      pasteFilesRef.current(files);
    };
    target.addEventListener('paste', handlePaste);
    detachPasteListenerRef.current = () => target.removeEventListener?.('paste', handlePaste);
  }, []);
  useLayoutEffect(() => {
    // Electron conversations are keyboard-first. Focus on mount and whenever
    // navigation changes the active conversation without remounting this shell.
    // Mobile intentionally keeps its current behaviour so opening a chat never
    // raises the software keyboard.
    if (!IS_ELECTRON || disabled) return;
    inputRef.current?.focus();
  }, [disabled, draftKey]);
  // Triggering a reply focuses the field so the keyboard rises together with
  // the quote. The request version also handles choosing the same reply again.
  useEffect(() => {
    if (!replyTo) return;
    inputRef.current?.focus();
    if (IS_ELECTRON || KeyboardController.isVisible()) return;

    // A native action-menu Modal may release its first responder after React
    // has already committed the reply. Restore it on the next task, once the
    // Modal teardown has reached the platform, so the software keyboard opens.
    const timer = setTimeout(() => KeyboardController.setFocusTo("current"), 0);
    return () => clearTimeout(timer);
  }, [focusRequestVersion, replyTo]);
  // When on, the return key sends (`submitBehavior="submit"` →
  // onSubmitEditing). Touch inserts a line break by long-pressing Send;
  // Electron keeps the browser-native Shift+Enter newline.
  const enterToSend = useChatPrefsStore((s) => s.enterToSend);
  // Latest caret/selection, tracked from the input (read-only — we don't control
  // `selection` during normal typing, only transiently right after a programmatic
  // newline insert, so the caret lands after it without fighting the IME).
  const selectionRef = useRef({ start: 0, end: 0 });
  const [forcedSelection, setForcedSelection] = useState<
    { start: number; end: number } | undefined
  >(undefined);
  // Shortcode autocomplete: while the whole draft is a short, single token,
  // offer the first few matching custom emojis above the field. The draft
  // itself updates per keystroke; only the *matching* runs off this debounced
  // copy, so typing never pays for the scan synchronously.
  const [suggestionQuery, setSuggestionQuery] = useState(value);
  // The keyboard-raised suggestion (Electron: ArrowUp selects the first
  // match, plain Enter sends it). Cleared by the debounce below on any value
  // change — typed or programmatic.
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState<
    number | null
  >(null);
  useEffect(() => {
    const timeout = setTimeout(() => {
      setSuggestionQuery(value);
      setSelectedSuggestionIndex(null);
    }, SUGGESTION_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [value]);

  const emojiSuggestions = useMemo(() => {
    const raw = suggestionQuery;
    if (!raw || raw.length > SUGGESTION_MAX_CHARS || /\s/.test(raw)) return [];
    // A leading `:` is the message token syntax — strip it for matching so
    // `:cat` finds the same shortcodes as `cat`.
    const q = (raw.startsWith(":") ? raw.slice(1) : raw).toLowerCase();
    if (!q) return [];
    const matched: CustomEmoji[] = [];
    // The send path's shortcode map already carries the right order
    // (standalone first, then packs) and dedupes by shortcode.
    for (const emoji of customEmojiByShortcode.values()) {
      if (!emoji.shortcode.toLowerCase().includes(q)) continue;
      matched.push(emoji);
      if (matched.length === SUGGESTION_LIMIT) break;
    }
    return matched;
  }, [suggestionQuery, customEmojiByShortcode]);

  // Measured content height, driving the field's auto-grow (onContentSizeChange).
  const [contentHeight, setContentHeight] = useState(INPUT_LINE_HEIGHT);
  // The real rendered height of ONE line, calibrated as the smallest non-empty
  // content height we've measured. Used to size multi-line growth exactly: the
  // typography line-height overshoots what iOS actually renders, so multiplying
  // it by the line count left slack that iOS top-anchored (text looked high). The
  // measured unit times the line count matches the content, so it stays centred.
  const [lineUnit, setLineUnit] = useState(INPUT_LINE_HEIGHT);
  // While recording, the whole composer row is replaced by the voice recorder.
  const [recording, setRecording] = useState(false);
  // Entering animations are for later mic/send and emoji/keyboard state changes.
  // Suppressing them on the initial mount keeps the route's first real composer
  // fully opaque while the native push is moving.
  const composerHasMounted = useRef(false);
  useEffect(() => {
    composerHasMounted.current = true;
  }, []);
  const [panelMode, setPanelMode] = useState<ComposerPanelMode>('attachments');
  const [emojiMounted, setEmojiMounted] = useState(false);
  // The provider keeps this volatile state below the chat's data component, so
  // opening composer chrome never re-runs message queries or list derivations.
  const { open: trayOpen, setOpen: setTrayOpen } = useChatComposerPanel();
  // Keep the heavy picker absent until its first real presentation. Its module
  // is preloaded by the chat shell; mounting the complete hidden tree in every
  // conversation adds entry and exit work even when the user never opens it.
  // Load the large Unicode catalog after the first custom-picker presentation.
  useEffect(() => {
    if (IS_ELECTRON || !emojiMounted || trayOpen || !liveDataEnabled) return;
    return scheduleComposerPanelWorkAfterPaint(() => {
      void import('./UnicodeEmojiPickerPanel');
    });
  }, [emojiMounted, liveDataEnabled, trayOpen]);
  const attachmentHeight = attachmentPanelHeight(
    panelWidth,
    insets.bottom,
    attachmentSources.length,
  );
  const fallbackEmojiHeight = Math.min(
    COMPOSER_PANEL_MAX_HEIGHT,
    Math.max(
      COMPOSER_PANEL_MIN_HEIGHT,
      Math.round(screenHeight * COMPOSER_PANEL_SCREEN_RATIO),
    ),
  );
  const [emojiPanelSize, setEmojiPanelSize] = useState(() => ({
    height: fallbackEmojiHeight,
    screenHeight,
    screenWidth,
  }));
  const emojiHeight =
    emojiPanelSize.screenHeight === screenHeight && emojiPanelSize.screenWidth === screenWidth
      ? emojiPanelSize.height
      : fallbackEmojiHeight;
  const SAFE = getBottomChromeInset(insets.bottom);
  const attachmentOpen = trayOpen && panelMode === 'attachments';
  const emojiOpen = trayOpen && panelMode === 'emoji';
  useEffect(() => {
    if (trayOpen && draftKey) markChatPanelCommit(draftKey);
  }, [draftKey, panelMode, trayOpen]);
  const activePanelHeight = panelMode === 'attachments' ? attachmentHeight : emojiHeight;

  const hasText = value.trim().length > 0;
  // Always keep the custom-emoji entry reachable: an empty collection still
  // contains the fixed first-cell action used to create the user's first emoji.
  const canSend = !disabled && !sending && hasText;
  // Keep the complete composer geometry while local reachability resolves. The
  // actions stay visible but disabled, so the first real row never gains a Plus
  // or microphone after the route transition.
  const showAttach = !!onPickAttachment && attachmentSources.length > 0;
  const showVoice = !!onSendVoice;
  const canAttach = !disabled && showAttach;
  const canVoice = !disabled && showVoice;
  const showMic = showVoice && !hasText;
  const showSend = hasText;

  // Touch hides the suggestion strip the moment the field blurs (tapping the
  // message list, opening a panel, dismissing the keyboard). Electron ignores
  // focus: clicking a card cell blurs the field on web, and hiding then would
  // unmount the cell before its click lands.
  const [inputFocused, setInputFocused] = useState(false);
  const suggestionsVisible =
    emojiSuggestions.length > 0 && (IS_ELECTRON || inputFocused);

  // Auto-grow height — applied ONLY for multiple lines. A single line keeps the
  // input height-less (it hugs its content and the wrapper centres it), so the
  // text stays vertically centred; forcing any height ≥ the snug text leaves
  // slack that iOS top-anchors, nudging the line up. For multiple lines we must
  // force a height because intrinsic sizing is unreliable for *programmatic*
  // edits (iOS doesn't re-measure a setValue, and a trailing '\n' isn't counted
  // until a glyph lands on it) — so a long-press newline wouldn't grow the field.
  // Take the larger of the measured height (catches soft-wrapped lines) and the
  // '\n' count times the calibrated real line height (catches the uncounted
  // trailing newline, exactly — no slack). Clamp to INPUT_MAX_HEIGHT, then scroll.
  const lineCount = value.length === 0 ? 1 : value.split("\n").length;
  const multiLineHeight =
    lineCount > 1
      ? Math.min(Math.max(contentHeight, lineCount * lineUnit), INPUT_MAX_HEIGHT)
      : undefined;

  // Content opacity stays independent from the slot height, allowing attachment
  // and emoji panels to cross-fade while the slot eases to the new natural size.
  const attachmentProgress = useSharedValue(0);
  const emojiProgress = useSharedValue(0);
  // Absolute custom-panel height. Each surface owns its target: attachments hug
  // their tile row, while emoji keeps its taller keyboard-like browsing area.
  // Start at the already-visible safe-area height so the first animation has no
  // invisible 0 → SAFE segment before the panel appears to move.
  const customPanelHeight = useSharedValue(SAFE);
  const keyboardTakeover = useSharedValue(0);
  const scheduledPanelTransitionRef = useRef<string | null>(null);
  const animatePanelTransition = useCallback(
    (open: boolean, mode: ComposerPanelMode, targetHeight: number) => {
      const key = open ? `${mode}:${targetHeight}` : `closed:${SAFE}`;
      scheduledPanelTransitionRef.current = key;
      keyboardTakeover.value = 0;
      attachmentProgress.value = withTiming(open && mode === 'attachments' ? 1 : 0, {
        duration: 140,
        easing: COMPOSER_PANEL_EASE,
      });
      emojiProgress.value = withTiming(open && mode === 'emoji' ? 1 : 0, {
        duration: 140,
        easing: COMPOSER_PANEL_EASE,
      });
      if (open) {
        const kb = keyboardHeight.value;
        // Seed a newly opening slot from the visible keyboard. For panel-to-panel
        // switches, retain the current absolute height and animate from there.
        if (customPanelHeight.value <= SAFE && kb > SAFE) customPanelHeight.value = kb;
        customPanelHeight.value = withTiming(targetHeight, {
          duration: 240,
          easing: COMPOSER_PANEL_EASE,
        }, (finished) => {
          if (finished && mode === 'emoji') runOnJS(setEmojiMounted)(true);
        });
      } else {
        // Ease down slowly so a rising keyboard reclaims the height first.
        customPanelHeight.value = withTiming(SAFE, {
          duration: 320,
          easing: COMPOSER_PANEL_EASE,
        }, (finished) => {
          if (finished && mode === 'emoji') runOnJS(setEmojiMounted)(false);
        });
      }
    },
    [
      attachmentProgress,
      customPanelHeight,
      emojiProgress,
      keyboardHeight,
      keyboardTakeover,
      SAFE,
    ],
  );
  useEffect(() => {
    const key = trayOpen ? `${panelMode}:${activePanelHeight}` : `closed:${SAFE}`;
    // Button handlers schedule the UI-thread animation before React reconciles.
    // Other close paths (message-area tap, input focus) still reconcile here.
    if (scheduledPanelTransitionRef.current === key) return;
    animatePanelTransition(trayOpen, panelMode, activePanelHeight);
  }, [
    activePanelHeight,
    animatePanelTransition,
    panelMode,
    trayOpen,
    SAFE,
  ]);

  const transitionPanelToKeyboard = useCallback(() => {
    // Do not shrink the panel before the keyboard starts moving. Fade its body,
    // then let panelStyle interpolate the occupied height directly from the
    // current panel to the keyboard with no down-then-up dip.
    scheduledPanelTransitionRef.current = `closed:${SAFE}`;
    keyboardTakeover.value = 1;
    attachmentProgress.value = withTiming(0, {
      duration: 140,
      easing: COMPOSER_PANEL_EASE,
    });
    emojiProgress.value = withTiming(0, {
      duration: 140,
      easing: COMPOSER_PANEL_EASE,
    });
  }, [attachmentProgress, emojiProgress, keyboardTakeover, SAFE]);

  useAnimatedReaction(
    () => keyboardProgress.value,
    (progress, previousProgress) => {
      if (keyboardTakeover.value === 1 && progress >= 1) {
        customPanelHeight.value = SAFE;
        keyboardTakeover.value = 0;
      } else if (
        keyboardTakeover.value === 1 &&
        progress <= 0 &&
        (previousProgress ?? 0) > 0
      ) {
        customPanelHeight.value = withTiming(SAFE, {
          duration: 180,
          easing: COMPOSER_PANEL_EASE,
        });
        keyboardTakeover.value = 0;
      }
    },
    [SAFE],
  );

  const plusStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${attachmentProgress.value * 45}deg` }],
  }));
  // The slot is the tallest of the keyboard, the animated active panel, or the
  // home-indicator safe area. Keyboard and custom surfaces never stack.
  const panelStyle = useAnimatedStyle(() => {
    const kb = keyboardHeight.value;
    if (keyboardTakeover.value === 1) {
      return {
        height: interpolateComposerPanelToKeyboard(
          customPanelHeight.value,
          kb,
          keyboardProgress.value,
          SAFE,
        ),
      };
    }
    return { height: Math.max(kb, customPanelHeight.value, SAFE) };
  });
  const attachmentStyle = useAnimatedStyle(() => ({ opacity: attachmentProgress.value }));
  const emojiStyle = useAnimatedStyle(() => ({ opacity: emojiProgress.value }));

  // Stable across renders (a ref holds the latest parent callback) so the
  // memoized AttachmentPanel never re-renders on keystrokes or tray toggles.
  const pickRef = useRef(onPickAttachment);
  pickRef.current = onPickAttachment;
  const handlePick = useCallback((source: AttachmentSource) => {
    setTrayOpen(false);
    setDesktopAttachmentAnchor(null);
    setDesktopEmojiVisible(false);
    pickRef.current?.(source);
  }, [setTrayOpen]);

  function toggleTray() {
    if (IS_ELECTRON) {
      setTrayOpen(false);
      setDesktopEmojiVisible(false);
      if (desktopAttachmentAnchor) {
        setDesktopAttachmentAnchor(null);
        return;
      }
      attachmentButtonRef.current?.measureInWindow((x, y) => {
        setDesktopAttachmentAnchor({ x, y });
      });
      return;
    }
    if (attachmentOpen) {
      transitionPanelToKeyboard();
      setTrayOpen(false);
      inputRef.current?.focus(); // raise the keyboard back
    } else {
      if (draftKey) markChatPanelRequest(draftKey);
      // Start compositor work before the React state update so first-open
      // reconciliation cannot delay the visible response to the tap.
      animatePanelTransition(true, 'attachments', attachmentHeight);
      setPanelMode('attachments');
      Keyboard.dismiss();
      setTrayOpen(true);
    }
  }

  function startRecording() {
    Keyboard.dismiss();
    setTrayOpen(false);
    setDesktopAttachmentAnchor(null);
    setDesktopEmojiVisible(false);
    setRecording(true);
  }

  function toggleEmojiPicker() {
    if (IS_ELECTRON) {
      setTrayOpen(false);
      setDesktopAttachmentAnchor(null);
      if (desktopEmojiVisible) {
        setDesktopEmojiVisible(false);
        return;
      }
      emojiButtonRef.current?.measureInWindow((x, y, width, height) => {
        setDesktopEmojiAnchor({ x, y, width, height });
        setDesktopEmojiMounted(true);
        setDesktopEmojiVisible(true);
      });
      return;
    }
    if (emojiOpen) {
      transitionPanelToKeyboard();
      setTrayOpen(false);
      inputRef.current?.focus();
      return;
    }
    if (draftKey) markChatPanelRequest(draftKey);
    const visibleKeyboardHeight = keyboardHeight.get();
    const nextEmojiHeight =
      visibleKeyboardHeight > SAFE ? visibleKeyboardHeight : fallbackEmojiHeight;
    // The UI-thread transition starts immediately. If idle prewarming has not
    // finished, its completion mounts the heavy picker after the motion settles.
    setEmojiPanelSize({
      height: nextEmojiHeight,
      screenHeight,
      screenWidth,
    });
    animatePanelTransition(true, 'emoji', nextEmojiHeight);
    setPanelMode('emoji');
    Keyboard.dismiss();
    setTrayOpen(true);
  }

  const sendRef = useRef(onSend);
  sendRef.current = onSend;
  const sendEmoji = useCallback((emoji: CustomEmoji) => {
    void sendRef.current(`:${emoji.shortcode}:`, [emoji]);
  }, []);

  const selectEmojiSuggestion = useCallback(
    (emoji: CustomEmoji) => {
      // A suggestion pick sends the emoji straight away through the
      // standalone send path and clears the draft, mirroring a sticker pick.
      // The filter input is cleared synchronously too — waiting for the
      // debounce would leave the card visible for one more beat.
      sendEmoji(emoji);
      setValue("");
      setSuggestionQuery("");
      setContentHeight(INPUT_LINE_HEIGHT);
      if (draftKey) clearDraft(draftKey);
      inputRef.current?.focus();
    },
    [clearDraft, draftKey, sendEmoji],
  );

  const insertUnicodeEmoji = useCallback(
    (emoji: string, restoreFocus: boolean) => {
      const currentValue = valueRef.current;
      const start = Math.min(selectionRef.current.start, currentValue.length);
      const end = Math.min(selectionRef.current.end, currentValue.length);
      const next = currentValue.slice(0, start) + emoji + currentValue.slice(end);
      const caret = start + emoji.length;
      valueRef.current = next;
      setValue(next);
      if (draftKey) setDraft(draftKey, next);
      setForcedSelection({ start: caret, end: caret });
      selectionRef.current = { start: caret, end: caret };
      if (restoreFocus) inputRef.current?.focus();
    },
    [draftKey, setDraft],
  );

  const selectInlineEmoji = useCallback(
    (emoji: string | CustomEmoji) => {
      if (typeof emoji === 'string') {
        insertUnicodeEmoji(emoji, false);
        return;
      }
      sendEmoji(emoji);
    },
    [insertUnicodeEmoji, sendEmoji],
  );

  function selectDesktopEmoji(emoji: string | CustomEmoji) {
    // Pick-and-done: a selection closes the desktop popover. A Unicode pick
    // then retakes composer focus so typing continues at the insertion caret.
    setDesktopEmojiVisible(false);
    if (typeof emoji !== 'string') {
      sendEmoji(emoji);
      return;
    }
    insertUnicodeEmoji(emoji, true);
  }

  // Native Enter-to-send uses `submitBehavior="submit"`, so return fires this
  // without inserting a newline. Electron is handled separately below because
  // React Native Web does not consume submitBehavior.
  function handleSubmitEditing() {
    if (enterToSend) void handleSend();
  }

  function handleComposerKeyPress(
    event: NativeSyntheticEvent<TextInputKeyPressEventData>,
  ) {
    if (!IS_ELECTRON) return;
    const desktopEvent = event as DesktopTextInputKeyEvent;
    const nativeEvent = desktopEvent.nativeEvent;
    const key = desktopEvent.key ?? nativeEvent.key;
    const isComposing =
      desktopEvent.isComposing ??
      nativeEvent.isComposing ??
      (desktopEvent.keyCode === 229 || nativeEvent.keyCode === 229);

    // With shortcode suggestions on screen, ArrowUp leaves the field and
    // enters the card (first match selected, caret hidden): ArrowLeft/Right
    // move within it, ArrowDown returns to the field with the caret at the
    // text end, and a plain Enter sends the selected match. All stay out of
    // the IME's way while a composition is in progress.
    if (!isComposing && emojiSuggestions.length > 0) {
      const inCard = selectedSuggestionIndex !== null;

      if (key === "ArrowUp") {
        // Swallow the key even in card mode: the field is one line, where the
        // default would move the (hidden) caret to the text start.
        event.preventDefault();
        if (!inCard) setSelectedSuggestionIndex(0);
        return;
      }
      if (key === "ArrowDown" && inCard) {
        event.preventDefault();
        setSelectedSuggestionIndex(null);
        setForcedSelection({ start: value.length, end: value.length });
        return;
      }
      if (inCard && (key === "ArrowLeft" || key === "ArrowRight")) {
        event.preventDefault();
        const delta = key === "ArrowLeft" ? (isRTL ? 1 : -1) : isRTL ? -1 : 1;
        setSelectedSuggestionIndex(
          Math.min(
            Math.max(selectedSuggestionIndex + delta, 0),
            emojiSuggestions.length - 1,
          ),
        );
        return;
      }
      if (
        inCard &&
        key === "Enter" &&
        !nativeEvent.shiftKey &&
        !nativeEvent.metaKey &&
        !nativeEvent.ctrlKey &&
        !nativeEvent.altKey
      ) {
        const emoji = emojiSuggestions[selectedSuggestionIndex];
        if (emoji) {
          event.preventDefault();
          selectEmojiSuggestion(emoji);
          return;
        }
      }
    }

    if (
      !shouldSendOnDesktopKeyPress({
        key,
        metaKey: desktopEvent.metaKey ?? nativeEvent.metaKey,
        ctrlKey: desktopEvent.ctrlKey ?? nativeEvent.ctrlKey,
        shiftKey: desktopEvent.shiftKey ?? nativeEvent.shiftKey,
        altKey: desktopEvent.altKey ?? nativeEvent.altKey,
        isComposing,
        repeat: desktopEvent.repeat ?? nativeEvent.repeat,
        platform: DESKTOP_OS,
        enterToSend,
      })
    ) {
      return;
    }
    event.preventDefault();
    void handleSend();
  }

  // On touch, long-press the send button (Enter-to-send only) to insert a line
  // break at the caret, then nudge the caret past it. Controlling `selection`
  // only for this one commit keeps normal typing uncontrolled.
  function insertNewline() {
    const start = Math.min(selectionRef.current.start, value.length);
    const end = Math.min(selectionRef.current.end, value.length);
    setValue(value.slice(0, start) + "\n" + value.slice(end));
    setForcedSelection({ start: start + 1, end: start + 1 });
    impact("light");
  }

  async function handleSend() {
    if (!canSend) return;
    const text = normalizeBareNostrUris(value.trim());
    const usedCustomEmojis: CustomEmoji[] = [];
    const seenShortcodes = new Set<string>();
    const shortcodeRe = /:([A-Za-z0-9_-]{1,64}):/g;
    let match: RegExpExecArray | null;
    while ((match = shortcodeRe.exec(text)) !== null) {
      const key = match[1].toLowerCase();
      const emoji = customEmojiByShortcode.get(key);
      if (emoji && !seenShortcodes.has(key)) {
        seenShortcodes.add(key);
        usedCustomEmojis.push(emoji);
      }
    }
    // Clear immediately — UI feels snappy. Restore on synchronous failure.
    // Clearing the value collapses the field back to one line (the empty-state
    // height clamp below); reset the measured height too so the next keystroke
    // doesn't briefly flash the prior multi-line height before it re-measures.
    setValue("");
    setContentHeight(INPUT_LINE_HEIGHT);
    if (draftKey) clearDraft(draftKey);
    setSending(true);
    try {
      await onSend(text, usedCustomEmojis);
    } catch (error) {
      // A pre-send gate can fail before publish work is scheduled. Restore the
      // draft in that case; failures after optimistic storage remain bubble state.
      setValue(text);
      if (draftKey) setDraft(draftKey, text);
      const failure = classifyMessageSendFailure(error);
      showToast(
        failure.kind === 'not_ready'
          ? t('composer.send_not_ready')
          : failure.kind === 'reason'
            ? failure.reason
            : t('composer.send_failed'),
      );
    } finally {
      setSending(false);
    }
  }

  useElectronComposerTypingFocus({
    enabled: !disabled && !recording,
    inputRef,
  });
  useElectronComposerEscape({
    active: replyTo != null,
    onCancel: onCancelReply,
  });

  if (recording && onSendVoice) {
    return (
      <VoiceRecorderBar
        onSendVoice={(p) => {
          setRecording(false);
          onSendVoice(p);
        }}
        onCancel={() => setRecording(false)}
      />
    );
  }

  return (
    <View
      onLayout={(event) => {
        const nextWidth = event.nativeEvent.layout.width;
        setPanelWidth((current) => (current === nextWidth ? current : nextWidth));
      }}
      style={{
        marginTop: -(
          bottomBarHeight +
          SAFE +
          (suggestionsVisible ? SUGGESTION_STRIP_HEIGHT : 0)
        ),
        zIndex: 1,
      }}
    >
      <View
        style={{
          position: "absolute",
          top: suggestionsVisible ? SUGGESTION_STRIP_HEIGHT : 0,
          start: 0,
          end: 0,
          bottom: 0,
          pointerEvents: "none",
        }}
      >
        <ChromeBackdrop scrollbarOcclusion="bottom" />
      </View>
      {suggestionsVisible ? (
        // Shortcode suggestions: a floating `surfaceElevated` card above the
        // input bar's top hairline, hugging its content with its leading
        // edge flush to the input box's leading edge. Its strip height is
        // compensated in this container's negative top margin, so the
        // message list never reflows.
        <View
          style={{
            height: SUGGESTION_STRIP_HEIGHT,
            justifyContent: "flex-end",
            zIndex: 1,
            // The input box starts after the attach button and the row gap
            // when they're present; otherwise at the composer gutter.
            paddingStart:
              spacing.lg +
              (showAttach ? COMPOSER_ACTION_SIZE + spacing.sm : 0),
          }}
        >
          <View
            style={{
              alignSelf: "flex-start",
              flexDirection: "row",
              gap: spacing.xs,
              padding: spacing.xs,
              // Let the floating card cross the row hairline by the same inset
              // as the desktop emoji picker, leaving `spacing.xs` above the
              // input controls.
              marginBottom: -spacing.xs,
              backgroundColor: c.surfaceElevated,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: c.border,
              borderRadius: radius.lg,
              ...shadow.float,
            }}
          >
            {emojiSuggestions.map((emoji, index) => (
              <Pressable
                key={`${emoji.shortcode}:${emoji.url}`}
                accessibilityRole="button"
                accessibilityLabel={emoji.shortcode}
                onPress={() => selectEmojiSuggestion(emoji)}
                style={({ pressed }) => ({
                  padding: spacing.xs,
                  borderRadius: radius.md,
                  backgroundColor:
                    pressed || index === selectedSuggestionIndex
                      ? c.surfaceMuted
                      : "transparent",
                })}
              >
                <CustomEmojiImage
                  emoji={emoji}
                  size={emojiSize.composerSuggestionImage}
                  clickable={false}
                  cornerRadius={radius.xs}
                />
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      <View
        style={{
          // Single-line height matches the tab bar (shared `bottomBarHeight`) so
          // the bottom edge doesn't shift between a tab screen and a chat; grows
          // past it as the field wraps to multiple lines. The 40px input/buttons
          // + 16px vertical padding already fill the 56, so the hairline border
          // would push the border-box to 56 + hairline — shave the top padding by
          // that hairline so the total lands *exactly* on bottomBarHeight.
          minHeight: bottomBarHeight,
          paddingHorizontal: 16,
          paddingTop: 8 - StyleSheet.hairlineWidth,
          paddingBottom: 8,
          // Hairline to match the tab bar's top border (the two bottom bars
          // should read identically).
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: c.border,
          flexDirection: "row",
          alignItems: "flex-end",
          gap: 8,
        }}
      >
        {showAttach ? (
          <View ref={attachmentButtonRef} collapsable={false}>
            <IconButton
              variant="surface"
              size={COMPOSER_ACTION_SIZE}
              onPress={toggleTray}
              disabled={!canAttach}
              icon={
                <Animated.View style={plusStyle}>
                  <Plus strokeWidth={iconStrokeWidth.default} size={22} color={c.text} />
                </Animated.View>
              }
            />
          </View>
        ) : null}
        <Animated.View
          style={{
            flex: 1,
            position: "relative",
            minHeight: 40,
            // Cap text growth; widen the cap while a reply quote is shown so the
            // quote + up-to-five text lines both fit.
            maxHeight:
              INPUT_MAX_HEIGHT + 16 + (replyTo ? REPLY_BLOCK_HEIGHT : 0),
            paddingHorizontal: INPUT_CONTENT_INSET,
            paddingVertical: 8,
            borderRadius: 20,
            backgroundColor: c.surface,
            justifyContent: "center",
            // Breathing room between the reply quote and the text field (only
            // applies while a quote is shown — the field is otherwise alone).
            gap: spacing.md,
          }}
        >
          {replyTo ? (
            <QuotedReply
              bare
              senderName={replyTo.senderName}
              contentPreview={replyTo.contentPreview}
              onCancel={onCancelReply}
              style={{
                // Pull the cancel X out past the box's content padding so
                // its right edge lands on the emoji button's trailing inset —
                // both trailing controls share one right edge.
                marginEnd: INPUT_ACTION_INSET - INPUT_CONTENT_INSET,
              }}
            />
          ) : null}
          <TextInput
            // Remount when the mode flips so iOS rebuilds the keyboard with the
            // new returnKeyType/submitBehavior. iOS won't refresh an already-
            // presented keyboard's return key in place; a fresh first-responder
            // cycle does. The flip only happens from the Settings screen (the
            // field isn't focused then), so remounting costs nothing — `value`
            // lives in the parent and survives.
            key={enterToSend ? "enter-send" : "enter-newline"}
            ref={setInputRef}
            value={value}
            // While the suggestion card owns the arrow keys on Electron, the
            // field keeps focus but hides its caret.
            caretHidden={IS_ELECTRON && selectedSuggestionIndex !== null}
            onChangeText={(text) => {
              setValue(text);
              // Typed input leaves the suggestion card immediately; the
              // debounce timeout clears programmatic value changes as a
              // backstop.
              setSelectedSuggestionIndex(null);
              if (draftKey) setDraft(draftKey, text);
            }}
            onFocus={() => {
              if (draftKey) markChatInputFocus(draftKey);
              if (trayOpen) transitionPanelToKeyboard();
              setInputFocused(true);
              setTrayOpen(false);
              setDesktopAttachmentAnchor(null);
              setDesktopEmojiVisible(false);
            }}
            onBlur={() => setInputFocused(false)}
            onPressIn={() => {
              if (draftKey) markChatInputPress(draftKey);
            }}
            onContentSizeChange={(e) => {
              const h = e.nativeEvent.contentSize.height;
              setContentHeight(h);
              // Calibrate the real one-line height: the smallest non-empty
              // content height we ever see is exactly one line. Only lower it
              // (multi-line measurements are larger and must not raise it).
              if (value.length > 0 && h > 0 && h < lineUnit) setLineUnit(h);
            }}
            selection={forcedSelection}
            onSelectionChange={(e) => {
              selectionRef.current = e.nativeEvent.selection;
              // Release control the instant the forced caret lands, so the IME
              // owns the selection again for subsequent typing.
              if (forcedSelection) setForcedSelection(undefined);
            }}
            // Native: `submit` makes return fire onSubmitEditing and changes the
            // keyboard label to "Send". Electron handles plain/modified Enter in
            // onKeyPress because React Native Web does not consume submitBehavior;
            // Shift+Enter remains the browser-native newline.
            submitBehavior={enterToSend ? "submit" : "newline"}
            onSubmitEditing={handleSubmitEditing}
            onKeyPress={IS_ELECTRON ? handleComposerKeyPress : undefined}
            returnKeyType={enterToSend ? "send" : "default"}
            placeholder={t("chat.input_placeholder")}
            placeholderTextColor={c.textMuted}
            multiline
            style={{
              color: c.text,
              fontSize: typography.body.fontSize,
              fontFamily: typography.body.fontFamily,
              // Chromium resolves `normal` to 21px for the 14px desktop font,
              // one pixel above our 20px empty-state cap. Use the registered
              // desktop body metric so content and viewport heights agree.
              lineHeight: IS_ELECTRON ? INPUT_LINE_HEIGHT : undefined,
              // Single line: no explicit height — the input hugs its content and
              // the wrapper (minHeight 40 + justifyContent center) centres it, so
              // the line sits dead-centre (on native, don't add lineHeight or
              // minHeight: any forced size leaves slack that iOS top-anchors).
              // Multi-line:
              // `multiLineHeight` forces growth (intrinsic sizing is unreliable
              // for programmatic newline inserts — see above). The empty-state
              // maxHeight pins back to one line so a just-sent / fully-deleted
              // field snaps down (iOS keeps a grown height after a programmatic
              // clear otherwise).
              height: multiLineHeight,
              maxHeight:
                value.length === 0 ? INPUT_LINE_HEIGHT : INPUT_MAX_HEIGHT,
              paddingTop: 0,
              paddingBottom: 0,
              // Android TextInput supplies a native leading inset. Clear it so
              // the empty caret shares the quoted reply strip's logical edge.
              paddingStart: 0,
              // Shorten the input itself instead of padding its content, so its
              // scroll indicator ends before the emoji action on every platform.
              paddingEnd: 0,
              marginEnd: INPUT_ACTION_RESERVE,
              textAlignVertical: "center",
            }}
          />
          <View
              ref={emojiButtonRef}
              collapsable={false}
              style={{
                position: "absolute",
                end: INPUT_ACTION_INSET,
                bottom: INPUT_ACTION_INSET,
              }}
            >
              <IconButton
                variant="plain"
                size={INPUT_ACTION_SIZE}
                onPress={toggleEmojiPicker}
                disabled={disabled}
                icon={
                  <Animated.View
                    key={emojiOpen ? 'keyboard' : 'emoji'}
                    entering={composerHasMounted.current ? FadeIn.duration(120) : undefined}
                  >
                    {emojiOpen ? (
                      <KeyboardIcon size={20} color={c.textMuted} />
                    ) : (
                      <Smile size={20} color={c.textMuted} />
                    )}
                  </Animated.View>
                }
                accessibilityLabel={
                  emojiOpen ? t("chat.emoji.show_keyboard") : t("chat.emoji.open_stickers")
                }
              />
          </View>
        </Animated.View>
        {showVoice || showSend ? (
          <View
            style={{
              width: COMPOSER_ACTION_SIZE,
              height: COMPOSER_ACTION_SIZE,
            }}
          >
            {showMic ? (
              <Animated.View
                key="mic"
                entering={composerHasMounted.current ? FadeIn.duration(120) : undefined}
                exiting={FadeOut.duration(120)}
                style={StyleSheet.absoluteFill}
              >
                <IconButton
                  variant="surface"
                  size={COMPOSER_ACTION_SIZE}
                  onPress={startRecording}
                  disabled={!canVoice}
                  icon={<Mic size={20} color={c.text} />}
                />
              </Animated.View>
            ) : showSend ? (
              // The shared outer action changes from mic to Send in place.
              <Animated.View
                key="send"
                entering={
                  composerHasMounted.current
                    ? ZoomIn.delay(70).duration(130)
                    : undefined
                }
                exiting={ZoomOut.duration(110)}
                style={StyleSheet.absoluteFill}
              >
                <IconButton
                  variant="accent"
                  size={COMPOSER_ACTION_SIZE}
                  onPress={handleSend}
                  // Touch users can long-press to insert a line break. Electron
                  // uses Shift+Enter and keeps this pointer-only action disabled.
                  onLongPress={
                    !IS_ELECTRON && enterToSend ? insertNewline : undefined
                  }
                  disabled={!canSend}
                  icon={
                    <Send
                      size={18}
                      color={canSend ? c.accentForeground : c.textMuted}
                      style={directionalIconStyle}
                    />
                  }
                />
              </Animated.View>
            ) : null}
          </View>
        ) : null}
      </View>
      {/* Bottom panel: keyboard space (covered by the OS keyboard), the tray, or
          the safe-area — one animated height so keyboard ⇄ tray never jumps. */}
      <Animated.View style={[{ overflow: "hidden" }, panelStyle]}>
        {showAttach ? (
          <Animated.View
            style={[
              {
                position: 'absolute',
                top: 0,
                start: 0,
                end: 0,
                height: attachmentHeight,
              },
              attachmentStyle,
              { pointerEvents: attachmentOpen ? 'auto' : 'none' },
            ]}
          >
            <AttachmentPanel
              width={panelWidth}
              sources={attachmentSources}
              onPick={handlePick}
            />
          </Animated.View>
        ) : null}
        {emojiMounted ? (
          <Animated.View
            style={[
              {
                position: 'absolute',
                top: 0,
                start: 0,
                end: 0,
                height: emojiHeight,
              },
              emojiStyle,
              { pointerEvents: emojiOpen ? 'auto' : 'none' },
            ]}
          >
            <Animated.View entering={FadeIn.duration(120)} style={{ flex: 1 }}>
              <ComposerEmojiPickerPanel
                active={emojiOpen}
                onSelect={selectInlineEmoji}
                customPacks={emojiCollection.packs}
                standaloneCustomEmojis={emojiCollection.standalone}
                safeBottom={insets.bottom}
                width={panelWidth}
              />
            </Animated.View>
          </Animated.View>
        ) : null}
      </Animated.View>
      {IS_ELECTRON && desktopAttachmentAnchor ? (
        <ComposerAttachmentMenu
          anchor={desktopAttachmentAnchor}
          sources={attachmentSources}
          onPick={handlePick}
          onClose={() => setDesktopAttachmentAnchor(null)}
        />
      ) : null}
      {IS_ELECTRON && desktopEmojiMounted ? (
        <Suspense fallback={null}>
          <LazyEmojiPickerSheet
            visible={desktopEmojiVisible}
            popoverAnchor={desktopEmojiAnchor ?? undefined}
            allowStandaloneEditing
            // The composer opens on the custom tab, matching the touch
            // composer's custom-only panel; the reaction picker keeps Unicode.
            initialMode="custom"
            customPacks={emojiCollection.packs}
            standaloneCustomEmojis={emojiCollection.standalone}
            onSelect={selectDesktopEmoji}
            onClose={() => setDesktopEmojiVisible(false)}
            onClosed={() => setDesktopEmojiMounted(false)}
          />
        </Suspense>
      ) : null}
    </View>
  );
}
