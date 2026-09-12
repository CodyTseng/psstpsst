import type { AudioSessionPort } from '../ports/audio-session';

/**
 * `expo-audio` touches its native module at **import time**, which throws in a
 * runtime that wasn't built with the module. Load it **lazily** and tolerate
 * its absence: if it can't load, mode switches become no-ops (audio session
 * configuration is non-critical — playback/recording still works with the OS
 * defaults). See the longer note in `./notifications.ts`.
 */
type AudioModule = typeof import('expo-audio');
let cached: AudioModule | null | undefined;
function load(): AudioModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('expo-audio') as AudioModule;
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * Audio session backed by `expo-audio`. The mode values mirror
 * `PLAYBACK_AUDIO_MODE` / `RECORDING_AUDIO_MODE` in `@/lib/audio/audio-mode`
 * (kept there for the component layer, which still drives `expo-audio`
 * directly). Always pass a whole mode: on iOS omitted fields fall back to
 * their record defaults — they do NOT merge with the active mode.
 */
export const audioSessionAdapter: AudioSessionPort = {
  setPlaybackMode: () =>
    load()?.setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }) ??
    Promise.resolve(),
  setRecordingMode: () =>
    load()?.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true }) ??
    Promise.resolve(),
};
