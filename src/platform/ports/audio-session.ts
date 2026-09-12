/**
 * Port for the OS audio-session mode. The app switches between playback (its
 * default) and recording (voice messages); both modes must ignore the hardware
 * silent switch so explicit, user-initiated audio always plays — see
 * `lib/audio/audio-mode.ts` for why a mode must always be installed whole.
 *
 * Async-first — see the module note in `secure-storage.ts`.
 */
export interface AudioSessionPort {
  /** Playback: no capture, ignore the silent switch. The app's default session. */
  setPlaybackMode(): Promise<void>;
  /** Recording: permit capture, still ignore the silent switch. */
  setRecordingMode(): Promise<void>;
}
