import { platform } from '@/platform';

const DIAGNOSTICS_DIRECTORY = 'diagnostics/';
const JOURNAL_FILE = 'app-errors.json';
const EXPORT_FILE = 'psstpsst-diagnostics.json';
const MAX_ENTRIES = 10;
const MAX_JOURNAL_BYTES = 128 * 1024;
const MAX_STACK_LENGTH = 4_000;
const REPEAT_WINDOW_MS = 5 * 60 * 1_000;

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

async function diagnosticsDirectory(): Promise<string | null> {
  const root = await platform.fileSystem.documentDirectoryUri();
  if (!root) return null;
  const directory = `${root}${DIAGNOSTICS_DIRECTORY}`;
  await platform.fileSystem.makeDirectory(directory, { intermediates: true, idempotent: true });
  return directory;
}

async function readJournal(directory: string): Promise<AppErrorJournal> {
  const uri = `${directory}${JOURNAL_FILE}`;
  try {
    const stat = await platform.fileSystem.stat(uri);
    if (!stat.exists || stat.size == null || stat.size > MAX_JOURNAL_BYTES) {
      return { version: 1, entries: [] };
    }
    const parsed = JSON.parse(await platform.fileSystem.readText(uri)) as Partial<AppErrorJournal>;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      return { version: 1, entries: [] };
    }
    return { version: 1, entries: parsed.entries.filter(isEntry).slice(-MAX_ENTRIES) };
  } catch {
    return { version: 1, entries: [] };
  }
}

async function writeJournal(directory: string, journal: AppErrorJournal): Promise<void> {
  await platform.fileSystem.writeText(
    `${directory}${JOURNAL_FILE}`,
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
    const journal = await readJournal(directory);
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
    await writeJournal(directory, journal);
    return consecutive;
  }).catch(() => 1);
}

/** Copy the bounded local journal to an OS-shareable cache file. */
export function exportAppErrorDiagnostics(): Promise<string | null> {
  return enqueue(async () => {
    const directory = await diagnosticsDirectory();
    const cacheRoot = await platform.fileSystem.cacheDirectoryUri();
    if (!directory || !cacheRoot) return null;
    const journal = await readJournal(directory);
    const uri = `${cacheRoot}${EXPORT_FILE}`;
    await platform.fileSystem.writeText(uri, JSON.stringify(journal, null, 2));
    return uri;
  }).catch(() => null);
}
