/* eslint-disable react-hooks/immutability -- VideoPlayer is a mutable native handle; property writes are its playback API. */
import { useEvent, useEventListener } from 'expo';
import type { VideoPlayer } from 'expo-video';
import Play from 'lucide-react-native/icons/play';
import Pause from 'lucide-react-native/icons/pause';
import Volume2 from 'lucide-react-native/icons/volume-2';
import VolumeX from 'lucide-react-native/icons/volume-x';
import Check from 'lucide-react-native/icons/check';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View, type TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';

import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import { IconButton } from '@/components/common/IconButton';
import { ContextMenu, CONTEXT_MENU_ICON_SIZE, type ContextMenuAnchor } from '@/components/common/ContextMenu';
import { formatPlayerClock } from '@/lib/audio/voice';
import { iconStrokeWidth } from '@/theme/icons';
import { shadow, spacing, uiDensity, useThemeColors } from '@/theme';
import { MediaSlider } from './MediaSlider';
import { mediaChromeLayout, useMediaChrome } from './MediaChrome';

const PLAYBACK_RATES = [0.5, 1, 1.25, 1.5, 2] as const;
const SEEK_CONFIRMATION_TOLERANCE = 0.1;
const CONTROLS_IDLE_MS = 3000;

/** Playback subscriptions stay inside the controls, away from the media pager. */
export function MediaPlaybackControls({ player }: { player: VideoPlayer }) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const insets = useSafeAreaInsets();
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const [duration, setDuration] = useState(player.duration);
  const { visible, setVisible, screenReaderEnabled, interactionVersion, touchControls } = useMediaChrome();
  const [interacting, setInteracting] = useState(false);
  const [speedMenu, setSpeedMenu] = useState<ContextMenuAnchor | null>(null);
  const speedButtonRef = useRef<View>(null);
  function closeSpeedMenu() { setSpeedMenu(null); touchControls(); }
  const startInteraction = () => { setInteracting(true); touchControls(); };
  const endInteraction = () => { setInteracting(false); touchControls(); };
  const [ended, setEnded] = useState(false);
  useEventListener(player, 'playToEnd', () => setEnded(true));
  useEventListener(player, 'sourceLoad', (event) => { setDuration(event.duration); setEnded(false); });
  const { muted } = useEvent(player, 'mutedChange', { muted: player.muted });
  const { playbackRate } = useEvent(player, 'playbackRateChange', { playbackRate: player.playbackRate });
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  const busy = status === 'loading' || (status === 'idle' && duration <= 0);
  useEffect(() => {
    if (!visible || !isPlaying || busy || interacting || speedMenu || screenReaderEnabled) return;
    const timer = setTimeout(() => { setVisible(false); }, CONTROLS_IDLE_MS);
    return () => clearTimeout(timer);
  }, [visible, isPlaying, busy, interacting, speedMenu, interactionVersion, screenReaderEnabled, setVisible]);
  useEventListener(player, 'playingChange', ({ isPlaying: playing }) => {
    if (!playing) touchControls();
  });
  useEffect(() => () => { touchControls(); }, [touchControls]);
  const iconProps = { size: uiDensity.headerActionIconSize, color: c.onOverlay, strokeWidth: iconStrokeWidth.default };

  return (
    <>
      <Pressable
        testID="media-controls-toggle"
        accessible={false}
        style={StyleSheet.absoluteFill}
        onPress={() => { setVisible((value) => !value); }}
      />
      <Animated.View
        layout={mediaChromeLayout}
        testID="media-playback-panel"
        onTouchStart={touchControls}
        accessibilityElementsHidden={!visible && !screenReaderEnabled}
        importantForAccessibility={visible || screenReaderEnabled ? 'auto' : 'no-hide-descendants'}
        style={{
          // Preserve layout while hidden so showing controls never animates from zero size.
          opacity: visible || screenReaderEnabled ? 1 : 0,
          position: 'absolute',
          start: spacing.lg + Math.max(insets.left, insets.right),
          end: spacing.lg + Math.max(insets.left, insets.right),
          bottom: insets.bottom + spacing.sm,
          gap: spacing.sm,
          pointerEvents: visible || screenReaderEnabled ? 'box-none' : 'none',
        }}
      >
        <MediaProgress player={player} duration={duration} disabled={status === 'error' || player.isLive} onSeek={() => setEnded(false)} onInteractionStart={startInteraction} onInteractionEnd={endInteraction} />
        <Animated.View layout={mediaChromeLayout} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
          <IconButton
            variant="overlay"
            size={uiDensity.headerActionSize}
            icon={isPlaying ? <Pause {...iconProps} /> : <Play {...iconProps} />}
            accessibilityLabel={t(isPlaying ? 'voice.pause' : 'voice.play')}
            disabled={busy}
            onPress={() => {
              if (player.playing) player.pause();
              else {
                if (!player.isLive && (ended || (player.duration > 0 && player.currentTime >= player.duration - SEEK_CONFIRMATION_TOLERANCE))) {
                  setEnded(false);
                  player.replay();
                } else player.play();
              }
            }}
          />
          <Animated.View layout={mediaChromeLayout} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <View ref={speedButtonRef} collapsable={false}>
              <AppButton
                variant="overlay"
                label={t('media.speed_value', { speed: playbackRate })}
                accessibilityLabel={t('media.playback_speed', { speed: playbackRate })}
                labelVariant="caption"
                size="sm"
                compact
                minimumSize={uiDensity.headerActionSize}
                corner="full"
                fullWidth={false}
                onPress={() => {
                  touchControls();
                  speedButtonRef.current?.measureInWindow((x, y, width) => {
                    setSpeedMenu({ x: x + width, y });
                  });
                }}
              />
            </View>
            <IconButton
              variant="overlay"
              size={uiDensity.headerActionSize}
              icon={muted ? <VolumeX {...iconProps} /> : <Volume2 {...iconProps} />}
              accessibilityLabel={t(muted ? 'media.unmute' : 'media.mute')}
              onPress={() => {
                player.muted = !player.muted;
                touchControls();
              }}
            />
          </Animated.View>
        </Animated.View>
      </Animated.View>
      {speedMenu ? <ContextMenu
        anchor={speedMenu}
        align="end"
        density="touch"
        onClose={closeSpeedMenu}
        items={PLAYBACK_RATES.map((rate) => ({
          key: String(rate),
          title: t('media.speed_value', { speed: rate }),
          selected: rate === playbackRate,
          icon: rate === playbackRate
            ? <Check size={CONTEXT_MENU_ICON_SIZE.touch} color={c.text} strokeWidth={iconStrokeWidth.default} />
            : <View style={{ width: CONTEXT_MENU_ICON_SIZE.touch, height: CONTEXT_MENU_ICON_SIZE.touch }} />,
          onPress: () => { player.playbackRate = rate; },
        }))}
      /> : null}
    </>
  );
}

function MediaProgress({ player, duration, disabled, onSeek, onInteractionStart, onInteractionEnd }: { player: VideoPlayer; duration: number; disabled: boolean; onSeek: () => void; onInteractionStart: () => void; onInteractionEnd: () => void }) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const [position, setPosition] = useState(player.currentTime);
  const draft = useRef<number | null>(null);
  const pendingSeek = useRef<number | null>(null);
  const resumeAfterScrub = useRef<boolean | null>(null);
  function finishSeek(currentTime: number) {
    pendingSeek.current = null;
    draft.current = null;
    const resume = resumeAfterScrub.current;
    resumeAfterScrub.current = null;
    setPosition(currentTime);
    if (resume) player.play();
  }
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    if (pendingSeek.current !== null && Math.abs(currentTime - pendingSeek.current) < SEEK_CONFIRMATION_TOLERANCE) {
      finishSeek(currentTime);
      return;
    }
    // A playback tick must not move the thumb away from the user's finger.
    if (draft.current === null) setPosition(currentTime);
  });
  const canSeek = !disabled && Number.isFinite(duration) && duration > 0;
  const max = canSeek ? duration : 1;
  const total = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const clockStyle: TextStyle = { ...shadow.mediaText, color: c.onOverlay, fontVariant: ['tabular-nums'] };
  function startScrub() {
    if (!canSeek) return;
    onInteractionStart();
    // Keep the original playback intent if another drag overtakes an in-flight seek.
    if (resumeAfterScrub.current === null) resumeAfterScrub.current = player.playing;
    pendingSeek.current = null;
    draft.current = position;
    if (player.playing) player.pause();
    player.scrubbingModeOptions = { ...player.scrubbingModeOptions, scrubbingModeEnabled: true };
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <AppText variant="caption" style={clockStyle}>{formatPlayerClock(position, total)}</AppText>
      <Animated.View layout={mediaChromeLayout} style={{ flex: 1 }}>
        <MediaSlider
          value={Math.min(max, Math.max(0, position))}
          max={max}
          disabled={!canSeek}
          accessibilityLabel={t('media.playback_position')}
          onSlidingStart={startScrub}
          onValueChange={(value) => {
            if (!canSeek) return;
            if (resumeAfterScrub.current === null) startScrub();
            const next = Math.min(duration, Math.max(0, value));
            draft.current = next;
            setPosition(next);
            // Native scrubbing coalesces frequent seeks while previewing frames.
            player.currentTime = next;
          }}
          onSlidingComplete={(value) => {
            if (!canSeek) return;
            const next = Math.min(duration, Math.max(0, value));
            if (resumeAfterScrub.current === null) startScrub();
            draft.current = next;
            pendingSeek.current = next;
            player.scrubbingModeOptions = { ...player.scrubbingModeOptions, scrubbingModeEnabled: false };
            onSeek();
            onInteractionEnd();
            player.currentTime = next;
            setPosition(next);
            // Native seeks can complete asynchronously. Ignore stale ticks until
            // the player acknowledges the target instead of flashing the old time.
            if (Math.abs(player.currentTime - next) < SEEK_CONFIRMATION_TOLERANCE) finishSeek(player.currentTime);
          }}
        />
      </Animated.View>
      <Animated.View layout={mediaChromeLayout}>
        <AppText variant="caption" style={clockStyle}>{formatPlayerClock(total)}</AppText>
      </Animated.View>
    </View>
  );
}
