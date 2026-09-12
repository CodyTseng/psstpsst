/**
 * Voice-message helpers shared by the recorder and the playback bubble:
 * normalizing recorder metering into 0–100 amplitude bars, downsampling the
 * captured stream to a fixed bar count, and formatting a clock label.
 */

/** Bars stored in the `waveform` tag (and drawn in the bubble). */
export const WAVEFORM_BARS = 48;

export type VoiceMime = `audio/${string}`;

/**
 * Reclassify an audio-only recording whose container signature is shared with
 * video. MP4 and WebM magic bytes identify the container, not whether it has a
 * video track, so generic sniffers commonly report voice recordings as video.
 */
export function normalizeVoiceMime(mime: string): string {
  switch (mime.split(';', 1)[0].trim().toLowerCase()) {
    case 'video/mp4':
    case 'application/mp4':
      return 'audio/mp4';
    case 'video/webm':
      return 'audio/webm';
    case 'video/3gpp':
      return 'audio/3gpp';
    default:
      return mime;
  }
}

/**
 * Resolve a recorder result to an audio MIME or fail closed. The declared type
 * comes first because MP4/WebM byte signatures cannot reveal whether a video
 * track exists; our recorder is audio-only and supplies that missing semantic.
 */
export function resolveVoiceMime(
  declaredMime: string | undefined,
  detectedMime: string | undefined,
): VoiceMime {
  for (const candidate of [declaredMime, detectedMime]) {
    if (!candidate) continue;
    const normalized = normalizeVoiceMime(candidate).split(';', 1)[0].trim().toLowerCase();
    if (normalized.startsWith('audio/')) return normalized as VoiceMime;
  }
  throw new Error('Voice recording did not resolve to an audio MIME type');
}

// expo-audio metering is dBFS: ~0 (loudest) down to a very negative floor. Map
// the useful top ~60 dB onto 0..1, then to a 0–100 integer.
const DB_FLOOR = -60;

/** One recorder metering sample (dBFS) → a 0–100 amplitude bar. */
export function meteringToAmplitude(db: number): number {
  if (!Number.isFinite(db)) return 0;
  const norm = (db - DB_FLOOR) / -DB_FLOOR; // -60→0, 0→1
  const clamped = norm < 0 ? 0 : norm > 1 ? 1 : norm;
  return Math.round(clamped * 100);
}

/**
 * Reduce the captured per-tick samples to exactly `target` bars by averaging
 * each bucket. Fewer samples than `target` are returned as-is (padding would
 * only invent data).
 */
export function downsampleWaveform(samples: number[], target = WAVEFORM_BARS): number[] {
  if (samples.length === 0) return [];
  if (samples.length <= target) return samples.map((s) => Math.round(s));
  const out: number[] = new Array(target);
  const bucket = samples.length / target;
  for (let i = 0; i < target; i++) {
    const start = Math.floor(i * bucket);
    const end = Math.floor((i + 1) * bucket);
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j];
    out[i] = Math.round(sum / Math.max(1, end - start));
  }
  return out;
}

/**
 * Build the fixed-width live recording strip: a constant `slots`-length bar
 * array so bar width never reflows as samples accrue. Recorded samples fill from
 * the left; the remainder are 0 (short grey placeholders). Once recording passes
 * `slots`, the strip scrolls to the most recent `slots`. `progress` marks the
 * recorded/placeholder boundary so the caller can colour the two halves.
 */
export function buildLiveStrip(
  samples: number[],
  slots: number,
): { bars: number[]; progress: number } {
  if (samples.length >= slots) {
    return { bars: samples.slice(-slots), progress: 1 };
  }
  const bars = samples.concat(new Array(slots - samples.length).fill(0));
  return { bars, progress: samples.length / slots };
}

/** Seconds → "m:ss" (e.g. 3 → "0:03", 75 → "1:15"). */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Seconds → a player clock whose fields keep the same digit count for the whole
 * clip. Clips under one hour use `MM:SS`; hour-long clips use `HH:MM:SS` and
 * reserve enough hour digits from their total duration before playback starts.
 */
export function formatPlayerClock(seconds: number, totalSeconds = seconds): string {
  const current = Math.max(0, Math.floor(seconds || 0));
  const total = Math.max(current, Math.floor(totalSeconds || 0));
  const remainingSeconds = (current % 60).toString().padStart(2, '0');
  if (total < 60 * 60) {
    const minutes = Math.floor(current / 60).toString().padStart(2, '0');
    return `${minutes}:${remainingSeconds}`;
  }

  const hourDigits = Math.max(2, String(Math.floor(total / (60 * 60))).length);
  const hours = Math.floor(current / (60 * 60)).toString().padStart(hourDigits, '0');
  const minutes = (Math.floor(current / 60) % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${remainingSeconds}`;
}
