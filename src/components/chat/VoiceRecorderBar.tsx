import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
} from "expo-audio";
import { ArrowUp } from '@solar-icons/react-native/category/arrows/Linear/ArrowUp';
import { Pause } from '@solar-icons/react-native/category/video/Linear/Pause';
import { Play } from '@solar-icons/react-native/category/video/Linear/Play';
import { Stop as Square } from '@solar-icons/react-native/category/video/Linear/Stop';
import { TrashBinTrash as Trash2 } from '@solar-icons/react-native/category/ui/Linear/TrashBinTrash';
import X from 'lucide-react-native/icons/x';
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/components/common/AppText";
import { IconButton } from "@/components/common/IconButton";
import { ChromeBackdrop } from "@/components/common/ChromeBackdrop";
import {
  PLAYBACK_AUDIO_MODE,
  RECORDING_AUDIO_MODE,
} from "@/lib/audio/audio-mode";
import {
  buildLiveStrip,
  downsampleWaveform,
  meteringToAmplitude,
  type VoiceMime,
} from "@/lib/audio/voice";
import { getBottomChromeInset } from "@/lib/layout/bottom-chrome";
import { platform } from "@/platform";
import { IS_ELECTRON } from '@/lib/platform';
import { iconStrokeWidth } from '@/theme/icons';
import { bottomBarHeight, useThemeColors } from "@/theme";

import { VoiceWaveform } from "./VoiceWaveform";
import { AudioClock } from './audio-clock';

export type VoicePayload = {
  uri: string;
  durationSec: number;
  waveform: number[];
  mime: VoiceMime;
};

const TICK_MS = 80;
// Fixed number of bars in the live strip — constant width, the unrecorded tail
// is short grey placeholders (see buildLiveStrip).
const LIVE_BARS = 40;
const MAX_SECONDS = 5 * 60;
const NATIVE_VOICE_MIME: VoiceMime = "audio/mp4";
const WEB_VOICE_MIME: VoiceMime = 'audio/webm';

type Props = {
  /** Hand off the finished recording to the send pipeline. */
  onSendVoice: (payload: VoicePayload) => void;
  /** Discard and return to the text composer. */
  onCancel: () => void;
};

/**
 * The voice composer (Telegram-style): replaces the input row while recording.
 * Tap the mic → this mounts and starts recording immediately; it shows a live
 * meter and a timer with cancel/stop. Stop moves to a preview where the clip can
 * be auditioned and scrubbed, then sent or deleted. Owns the recorder/player and
 * cleans up the temp file unless it's handed off on send. (DESIGN §8)
 */
export function VoiceRecorderBar({ onSendVoice, onCancel }: Props) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    web: {
      ...RecordingPresets.HIGH_QUALITY.web,
      mimeType: WEB_VOICE_MIME,
    },
    isMeteringEnabled: true,
  });

  const [phase, setPhase] = useState<"recording" | "preview">("recording");
  // False during the native setup chain (permission → audio-session activation →
  // prepareToRecordAsync), which can take up to ~2s — notably right after
  // playing a clip, when iOS must tear down the playback route. The bar shows a
  // "preparing" state until capture truly begins, so the user doesn't start
  // talking before the mic is live (and lose the first second).
  const [ready, setReady] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  // The live strip is a fixed-length array from the start (all placeholders),
  // so bar width never reflows; `liveProgress` splits recorded vs placeholder.
  const [liveBars, setLiveBars] = useState<number[]>(() =>
    new Array(LIVE_BARS).fill(0),
  );
  const [liveProgress, setLiveProgress] = useState(0);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewMime, setPreviewMime] = useState(NATIVE_VOICE_MIME);
  const [waveform, setWaveform] = useState<number[]>([]);

  const samplesRef = useRef<number[]>([]);
  const startRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sentRef = useRef(false);
  // Mirror for the unmount cleanup so it deletes the latest temp file.
  const previewUriRef = useRef<string | null>(null);
  previewUriRef.current = previewUri;

  const player = useAudioPlayer(previewUri, { updateInterval: 50 });
  const status = useAudioPlayerStatus(player);
  const previewDuration = status.duration > 0 ? status.duration : elapsed;
  const previewProgress =
    previewDuration > 0 ? Math.min(1, status.currentTime / previewDuration) : 0;

  function stopTick() {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }

  async function finishRecording() {
    if (tickRef.current === null) return; // already stopped
    stopTick();
    try {
      await recorder.stop();
    } catch {
      // fall through — use whatever uri exists
    }
    // Back to playback — crucially still `playsInSilentMode: true`, so the
    // preview plays on a silenced phone (a bare `{ allowsRecording: false }`
    // would reset that to false and mute it — see audio-mode.ts).
    await setAudioModeAsync(PLAYBACK_AUDIO_MODE).catch(() => {});
    let uri = recorder.uri;
    if (!uri) {
      onCancel();
      return;
    }
    if (IS_ELECTRON) {
      const response = await fetch(uri);
      const blob = await response.blob();
      const managedUri = `${await platform.fileSystem.cacheDirectoryUri()}voice-${await platform.deviceCrypto.randomUUID()}.weba`;
      await platform.fileSystem.writeBytes(managedUri, new Uint8Array(await blob.arrayBuffer()));
      URL.revokeObjectURL(uri);
      uri = managedUri;
      // Chromium may label an audio-only WebM Blob as `video/webm`; the
      // recorder only requested an audio stream, so publish its semantic type.
      setPreviewMime(WEB_VOICE_MIME);
    }
    setPreviewUri(uri);
    setWaveform(downsampleWaveform(samplesRef.current));
    setPhase("preview");
  }

  // Mount → request permission and start recording.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const perm = await requestRecordingPermissionsAsync();
      if (cancelled) return;
      if (!perm.granted) {
        void platform.confirmationDialog.notify({
          title: t("voice.permission"),
          okLabel: t("common.ok"),
        });
        onCancel();
        return;
      }
      await setAudioModeAsync(RECORDING_AUDIO_MODE);
      if (cancelled) return;
      await recorder.prepareToRecordAsync();
      if (cancelled) return;
      recorder.record();
      startRef.current = Date.now();
      setReady(true);
      tickRef.current = setInterval(() => {
        const secs = (Date.now() - startRef.current) / 1000;
        setElapsed(secs);
        const m = recorder.getStatus().metering;
        samplesRef.current.push(
          meteringToAmplitude(typeof m === "number" ? m : -60),
        );
        const strip = buildLiveStrip(samplesRef.current, LIVE_BARS);
        setLiveBars(strip.bars);
        setLiveProgress(strip.progress);
        if (secs >= MAX_SECONDS) void finishRecording();
      }, TICK_MS);
    })();
    return () => {
      cancelled = true;
      stopTick();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Unmount → delete the temp recording unless it was handed off on send.
  useEffect(() => {
    return () => {
      const u = previewUriRef.current;
      if (!sentRef.current && u) {
        platform.fileSystem.delete(u, { idempotent: true }).catch(() => {});
      }
    };
  }, []);

  function handleCancel() {
    stopTick();
    if (phase === "recording") {
      recorder
        .stop()
        .then(() => {
          if (recorder.uri && IS_ELECTRON) {
            URL.revokeObjectURL(recorder.uri);
          } else if (recorder.uri) {
            platform.fileSystem
              .delete(recorder.uri, { idempotent: true })
              .catch(() => {});
          }
        })
        .catch(() => {});
    }
    // Hand the session back to the playback default — otherwise a cancel from
    // the recording phase leaves it in `playAndRecord`, routing later voice
    // playback to the earpiece.
    void setAudioModeAsync(PLAYBACK_AUDIO_MODE).catch(() => {});
    onCancel();
  }

  async function togglePreview() {
    if (status.playing) {
      player.pause();
    } else {
      // Await the rewind before play() — see AttachmentAudio.onToggle.
      if (previewProgress >= 0.999) await player.seekTo(0);
      player.play();
    }
  }

  function handleSend() {
    if (!previewUri) return;
    sentRef.current = true; // hand off — keep the file for the upload pipeline
    onSendVoice({
      uri: previewUri,
      durationSec: Math.max(1, Math.round(elapsed)),
      waveform,
      mime: previewMime,
    });
  }

  // Mirror ChatInput's geometry exactly so swapping the text composer for the
  // recorder doesn't shift the bottom edge or the side gutter: a `bottomBarHeight`
  // bar (the standard 16px horizontal gutter, hairline top border, top padding
  // shaved by the hairline so the border-box lands exactly on 56) over a separate
  // safe-area panel.
  const bar = {
    minHeight: bottomBarHeight,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 8 - StyleSheet.hairlineWidth,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
  };
  const safe = getBottomChromeInset(insets.bottom);

  if (phase === "recording") {
    return (
      <View style={{ marginTop: -(bottomBarHeight + safe), zIndex: 1 }}>
        <ChromeBackdrop scrollbarOcclusion="bottom" />
        <View style={bar}>
          <IconButton
            variant="surface"
            size={40}
            onPress={handleCancel}
            icon={<X strokeWidth={iconStrokeWidth.default} size={22} color={c.text} />}
            accessibilityLabel={t("voice.cancel")}
          />
          {ready ? (
            <>
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: c.danger,
                }}
              />
              <AudioClock seconds={elapsed} color={c.textMuted} />
              <View style={{ flex: 1 }}>
                <VoiceWaveform
                  bars={liveBars}
                  progress={liveProgress}
                  playedColor={c.accent}
                  trackColor={c.surfaceMuted}
                />
              </View>
            </>
          ) : (
            // Native setup still in flight — the mic isn't capturing yet.
            <View
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
              }}
            >
              <ActivityIndicator size="small" color={c.textMuted} />
              <AppText variant="caption" tone="muted">
                {t("voice.preparing")}
              </AppText>
            </View>
          )}
          <IconButton
            variant="accent"
            size={40}
            disabled={!ready}
            onPress={() => void finishRecording()}
            icon={
              <Square
                size={16}
                color={ready ? c.accentForeground : c.textMuted}
                fill={ready ? c.accentForeground : c.textMuted}
              />
            }
            accessibilityLabel={t("voice.stop")}
          />
        </View>
        <View style={{ height: safe }} />
      </View>
    );
  }

  return (
    <View style={{ marginTop: -(bottomBarHeight + safe), zIndex: 1 }}>
      <ChromeBackdrop scrollbarOcclusion="bottom" />
      <View style={bar}>
        <IconButton
          variant="surface"
          size={40}
          onPress={handleCancel}
          icon={<Trash2 size={20} color={c.danger} />}
          accessibilityLabel={t("voice.delete")}
        />
        <IconButton
          variant="surface"
          size={40}
          onPress={() => void togglePreview()}
          icon={
            status.playing ? (
              <Pause size={18} color={c.text} fill={c.text} />
            ) : (
              <Play size={18} color={c.text} fill={c.text} />
            )
          }
          accessibilityLabel={
            status.playing ? t("voice.pause") : t("voice.play")
          }
        />
        <View style={{ flex: 1 }}>
          <VoiceWaveform
            bars={waveform.length > 0 ? waveform : [0]}
            progress={previewProgress}
            playedColor={c.accent}
            trackColor={c.surfaceMuted}
            onSeek={(f) => {
              void player.seekTo(f * previewDuration);
            }}
          />
        </View>
        <AudioClock
          seconds={
            status.playing || status.currentTime > 0
              ? status.currentTime
              : elapsed
          }
          totalSeconds={elapsed}
          color={c.textMuted}
          align="end"
        />
        <IconButton
          variant="accent"
          size={40}
          onPress={handleSend}
          icon={
            <ArrowUp size={18} color={c.accentForeground} />
          }
          accessibilityLabel={t("voice.send")}
        />
      </View>
      <View style={{ height: safe }} />
    </View>
  );
}
