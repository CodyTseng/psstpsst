import { platform } from '@/platform';

/**
 * The app's audio-session modes, defined **once** so no playback path can
 * silently drop `playsInSilentMode` and route back to the silent-switch-
 * respecting category.
 *
 * The trap: `setAudioModeAsync` takes a `Partial<AudioMode>`, but on iOS the
 * omitted fields fall back to their record **defaults** — it does NOT merge with
 * the currently-active mode. So a terse call like `{ allowsRecording: false }`
 * quietly resets `playsInSilentMode` to `false`, and playback goes mute on a
 * phone whose ring/silent switch is set to silent. Always pass a whole mode from
 * here.
 */

/**
 * Playback: ignore the hardware silent switch, so explicit, user-initiated audio
 * (a voice-message bubble, the recorder preview) plays even when the phone is on
 * silent — the way every other messenger behaves. The app's default session.
 */
export const PLAYBACK_AUDIO_MODE = {
  allowsRecording: false,
  playsInSilentMode: true,
};

/**
 * Recording: the same silent-switch override, but the session must permit
 * capture (iOS `playAndRecord`).
 */
export const RECORDING_AUDIO_MODE = {
  allowsRecording: true,
  playsInSilentMode: true,
};

/**
 * Install the default (playback) audio session. Call once at startup so every
 * player — chat voice bubbles, the recorder preview — ignores the silent switch
 * without each having to configure it. Best-effort (audio is non-critical).
 */
export function configurePlaybackAudio(): Promise<void> {
  return platform.audioSession.setPlaybackMode().catch(() => {});
}
