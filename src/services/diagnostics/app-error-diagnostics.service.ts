import { platform } from '@/platform';

const DIAGNOSTICS_DIRECTORY = 'diagnostics/';
const ROUTE_JOURNAL_FILE = 'app-errors.json';
const PLAYBACK_JOURNAL_FILE = 'video-playback-errors.json';
export const APP_ERROR_DIAGNOSTICS_FILENAME = 'psstpsst-diagnostics.json';
const MAX_ENTRIES = 10;
const MAX_JOURNAL_BYTES = 128 * 1024;
const MAX_STACK_LENGTH = 4_000;
const REPEAT_WINDOW_MS = 5 * 60 * 1_000;
const APP_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const CHROMIUM_VERSION_PATTERN = /^\d+\.\d+\.\d+\.\d+$/;

// Chromium's readable PipelineStatusCodes from media/base/pipeline_status.h.
const CHROMIUM_MEDIA_ERRORS = new Set([
  'PIPELINE_ERROR_NETWORK',
  'PIPELINE_ERROR_DECODE',
  'PIPELINE_ERROR_ABORT',
  'PIPELINE_ERROR_INITIALIZATION_FAILED',
  'PIPELINE_ERROR_COULD_NOT_RENDER',
  'PIPELINE_ERROR_READ',
  'PIPELINE_ERROR_INVALID_STATE',
  'PIPELINE_ERROR_EXTERNAL_RENDERER_FAILED',
  'PIPELINE_ERROR_HARDWARE_CONTEXT_RESET',
  'PIPELINE_ERROR_DISCONNECTED',
  'PIPELINE_ERROR_OUT_OF_MEMORY',
  'DEMUXER_ERROR_COULD_NOT_OPEN',
  'DEMUXER_ERROR_COULD_NOT_PARSE',
  'DEMUXER_ERROR_NO_SUPPORTED_STREAMS',
  'DEMUXER_ERROR_DETECTED_HLS',
  'DEMUXER_ERROR_BITSTREAM_CONVERSION_FAILED',
  'DEMUXER_ERROR_PROGRESSIVE_DISABLED',
  'DEMUXER_ERROR_SYMPHONIA_UNSUPPORTED',
  'DECODER_ERROR_NOT_SUPPORTED',
  'CHUNK_DEMUXER_ERROR_APPEND_FAILED',
  'CHUNK_DEMUXER_ERROR_EOS_STATUS_DECODE_ERROR',
  'CHUNK_DEMUXER_ERROR_EOS_STATUS_NETWORK_ERROR',
  'AUDIO_RENDERER_ERROR',
]);

type VideoPlaybackEntry = {
  occurredAt: number;
  code: number;
  chromiumError?: string;
  currentTime: number;
  duration?: number;
  source: 'attachment' | 'remote' | 'other';
  appVersion: string;
  chromiumVersion: string;
};

type VideoPlaybackContext = Omit<VideoPlaybackEntry, 'occurredAt' | 'chromiumError'> & {
  message: string;
};

type StoredVideoPlaybackEntry = Omit<VideoPlaybackEntry, 'appVersion' | 'chromiumVersion'> & {
  appVersion?: unknown;
  chromiumVersion?: unknown;
};

export type AppErrorContext = {
  errorName: string;
  stack?: string;
  route: string;
  appVersion: string;
  build: string;
  platform: string;
  platformVersion: string;
};

type AppErrorEntry = AppErrorContext & {
  occurredAt: number;
};

type AppErrorJournal = {
  version: 1;
  entries: AppErrorEntry[];
  videoPlaybackErrors?: VideoPlaybackEntry[];
};

type StoredJournal = {
  version: 1;
  entries?: unknown;
  videoPlaybackErrors?: unknown;
};

let writeQueue: Promise<void> = Promise.resolve();

function safeToken(value: string, fallback: string, maxLength = 120): string {
  const normalized = value.replace(/[^a-zA-Z0-9_.:/()[\]-]/g, '_').slice(0, maxLength);
  return normalized || fallback;
}

function sanitizeStack(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  const frames = stack
    .split('\n')
    .slice(1, 33)
    .map((line) =>
      line
        .replace(/(?:https?|wss?|file|content|psstpsst(?:-dev)?):[^\s)]+/gi, '[uri]')
        .replace(/\b(?:npub|nsec|nprofile|nevent|note)1[023456789acdefghjklmnpqrstuvwxyz]+\b/gi, '[nostr]')
        .replace(/\b[0-9a-f]{64}\b/gi, '[hex64]')
        .replace(/\/[^\s():]+\/(src|modules|desktop|node_modules)\//g, '$1/')
        .replace(/[a-z]:\\[^\s():]+\\(src|modules|desktop|node_modules)\\/gi, '$1/'),
    )
    .join('\n')
    .slice(0, MAX_STACK_LENGTH);
  return frames || undefined;
}

function normalizeContext(context: AppErrorContext): AppErrorContext {
  return {
    errorName: safeToken(context.errorName, 'Error', 80),
    stack: sanitizeStack(context.stack),
    route: safeToken(context.route, 'unknown', 200),
    appVersion: safeToken(context.appVersion, 'unknown', 40),
    build: safeToken(context.build, 'unknown', 40),
    platform: safeToken(context.platform, 'unknown', 40),
    platformVersion: safeToken(context.platformVersion, 'unknown', 80),
  };
}

function isEntry(value: unknown): value is AppErrorEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<AppErrorEntry>;
  return (
    // Discard playback entries from the original mixed journal.
    !('videoPlayback' in entry) &&
    typeof entry.occurredAt === 'number' &&
    Number.isFinite(entry.occurredAt) &&
    typeof entry.errorName === 'string' &&
    typeof entry.route === 'string' &&
    typeof entry.appVersion === 'string' &&
    typeof entry.build === 'string' &&
    typeof entry.platform === 'string' &&
    typeof entry.platformVersion === 'string' &&
    (entry.stack === undefined || typeof entry.stack === 'string')
  );
}

function isStoredVideoPlaybackEntry(value: unknown): value is StoredVideoPlaybackEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<StoredVideoPlaybackEntry>;
  return (
    Number.isFinite(entry.occurredAt) &&
    Number.isInteger(entry.code) &&
    Number.isFinite(entry.currentTime) &&
    (entry.duration === undefined || Number.isFinite(entry.duration)) &&
    (entry.source === 'attachment' || entry.source === 'remote' || entry.source === 'other') &&
    (entry.chromiumError === undefined || CHROMIUM_MEDIA_ERRORS.has(entry.chromiumError))
  );
}

function safePlaybackVersion(value: unknown, pattern: RegExp): string {
  return typeof value === 'string' && value.length <= 40 && pattern.exec(value)?.[0] === value
    ? value
    : 'unknown';
}

async function diagnosticsDirectory(): Promise<string | null> {
  const root = await platform.fileSystem.documentDirectoryUri();
  if (!root) return null;
  const directory = `${root}${DIAGNOSTICS_DIRECTORY}`;
  await platform.fileSystem.makeDirectory(directory, { intermediates: true, idempotent: true });
  return directory;
}

async function readJournalFile(uri: string): Promise<StoredJournal | null> {
  try {
    const stat = await platform.fileSystem.stat(uri);
    if (!stat.exists || stat.size == null || stat.size > MAX_JOURNAL_BYTES) {
      return null;
    }
    const parsed = JSON.parse(await platform.fileSystem.readText(uri)) as StoredJournal | null;
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function readPlaybackEntries(value: unknown): VideoPlaybackEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isStoredVideoPlaybackEntry).slice(-MAX_ENTRIES).map((entry) => ({
    occurredAt: entry.occurredAt,
    code: entry.code,
    chromiumError: entry.chromiumError,
    currentTime: entry.currentTime,
    duration: entry.duration,
    source: entry.source,
    appVersion: safePlaybackVersion(entry.appVersion, APP_VERSION_PATTERN),
    chromiumVersion: safePlaybackVersion(entry.chromiumVersion, CHROMIUM_VERSION_PATTERN),
  }));
}

async function readRouteJournal(directory: string): Promise<AppErrorJournal> {
  const parsed = await readJournalFile(`${directory}${ROUTE_JOURNAL_FILE}`);
  if (!Array.isArray(parsed?.entries)) return { version: 1, entries: [] };
  return {
    version: 1,
    entries: parsed.entries.filter(isEntry).slice(-MAX_ENTRIES),
    videoPlaybackErrors: readPlaybackEntries(parsed.videoPlaybackErrors),
  };
}

async function writeRouteJournal(directory: string, journal: AppErrorJournal): Promise<void> {
  await platform.fileSystem.writeText(
    `${directory}${ROUTE_JOURNAL_FILE}`,
    JSON.stringify(journal),
  );
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(task, task);
  writeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** Persist one privacy-filtered route failure and return its consecutive count. */
export function recordAppError(context: AppErrorContext): Promise<number> {
  return enqueue(async () => {
    const directory = await diagnosticsDirectory();
    if (!directory) return 1;
    const journal = await readRouteJournal(directory);
    const normalized = normalizeContext(context);
    const occurredAt = Date.now();
    const previous = journal.entries.at(-1);
    let consecutive = 1;
    if (
      previous &&
      previous.errorName === normalized.errorName &&
      previous.route === normalized.route &&
      occurredAt - previous.occurredAt <= REPEAT_WINDOW_MS
    ) {
      for (let index = journal.entries.length - 1; index >= 0; index -= 1) {
        const entry = journal.entries[index];
        if (
          entry.errorName !== normalized.errorName ||
          entry.route !== normalized.route ||
          occurredAt - entry.occurredAt > REPEAT_WINDOW_MS
        ) {
          break;
        }
        consecutive += 1;
      }
    }
    journal.entries.push({ ...normalized, occurredAt });
    if (journal.entries.length > MAX_ENTRIES) {
      journal.entries.splice(0, journal.entries.length - MAX_ENTRIES);
    }
    await writeRouteJournal(directory, journal);
    return consecutive;
  }).catch(() => 1);
}

/** Journal a playback failure without affecting route recovery. */
export function recordVideoPlaybackError(context: VideoPlaybackContext): Promise<void> {
  const { code, message, currentTime, duration, source, appVersion, chromiumVersion } = context;
  const identifier = /^(?:PipelineStatus::)?([A-Z][A-Z_]+)\b/.exec(message)?.[1];
  const entry: VideoPlaybackEntry = {
    occurredAt: Date.now(),
    code,
    chromiumError: identifier && CHROMIUM_MEDIA_ERRORS.has(identifier) ? identifier : undefined,
    currentTime,
    duration,
    source,
    appVersion: safePlaybackVersion(appVersion, APP_VERSION_PATTERN),
    chromiumVersion: safePlaybackVersion(chromiumVersion, CHROMIUM_VERSION_PATTERN),
  };
  return enqueue(async () => {
    const directory = await diagnosticsDirectory();
    if (!directory) return;
    const uri = `${directory}${PLAYBACK_JOURNAL_FILE}`;
    const journal = await readJournalFile(uri);
    // Seed the separate journal from older combined journals on the first write.
    const history = readPlaybackEntries(journal?.videoPlaybackErrors)
      ?? (await readRouteJournal(directory)).videoPlaybackErrors
      ?? [];
    await platform.fileSystem.writeText(uri, JSON.stringify({
      version: 1,
      videoPlaybackErrors: [...history, entry].slice(-MAX_ENTRIES),
    }));
  }).catch(() => undefined);
}

/** Combine the bounded local journals into an OS-shareable cache file. */
export function exportAppErrorDiagnostics(): Promise<string | null> {
  return enqueue(async () => {
    const directory = await diagnosticsDirectory();
    const cacheRoot = await platform.fileSystem.cacheDirectoryUri();
    if (!directory || !cacheRoot) return null;
    const [journal, playbackJournal] = await Promise.all([
      readRouteJournal(directory),
      readJournalFile(`${directory}${PLAYBACK_JOURNAL_FILE}`),
    ]);
    journal.videoPlaybackErrors = readPlaybackEntries(playbackJournal?.videoPlaybackErrors)
      ?? journal.videoPlaybackErrors;
    const uri = `${cacheRoot}${APP_ERROR_DIAGNOSTICS_FILENAME}`;
    await platform.fileSystem.writeText(uri, JSON.stringify(journal, null, 2));
    return uri;
  }).catch(() => null);
}
