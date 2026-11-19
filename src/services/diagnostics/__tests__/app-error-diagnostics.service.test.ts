import { platform } from '@/platform';

import {
  exportAppErrorDiagnostics,
  recordAppError,
  recordVideoPlaybackError,
  type AppErrorContext,
} from '../app-error-diagnostics.service';

const mockFiles = new Map<string, string>();
const routeJournalUri = 'file:///documents/diagnostics/app-errors.json';
const playbackJournalUri = 'file:///documents/diagnostics/video-playback-errors.json';

jest.mock('@/platform', () => ({
  platform: {
    fileSystem: {
      documentDirectoryUri: jest.fn(async () => 'file:///documents/'),
      cacheDirectoryUri: jest.fn(async () => 'file:///cache/'),
      makeDirectory: jest.fn(async () => {}),
      stat: jest.fn(async (uri: string) => ({
        exists: mockFiles.has(uri),
        isDirectory: false,
        size: mockFiles.get(uri)?.length ?? null,
        creationTime: null,
        modificationTime: null,
      })),
      readText: jest.fn(async (uri: string) => {
        const value = mockFiles.get(uri);
        if (value === undefined) throw new Error('missing');
        return value;
      }),
      writeText: jest.fn(async (uri: string, value: string) => {
        mockFiles.set(uri, value);
      }),
    },
  },
}));

const context: AppErrorContext = {
  errorName: 'TypeError',
  stack: [
    'TypeError: private message content',
    '    at render (https://relay.example/path?npub=npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq)',
    `    at open (/Users/person/project/src/app/chat.tsx:${'a'.repeat(64)})`,
    '    at dependency (/Users/person/project/node_modules/package/index.js:12:3)',
    '    at windows (C:\\Users\\person\\project\\src\\app\\chat.tsx:4:2)',
  ].join('\n'),
  route: '(app)/chat/[key]',
  appVersion: '1.2.3',
  build: '42',
  platform: 'android',
  platformVersion: '36',
};

describe('app error diagnostics', () => {
  beforeEach(() => {
    mockFiles.clear();
  });

  it('stores only bounded, privacy-filtered diagnostic fields', async () => {
    await expect(recordAppError(context)).resolves.toBe(1);
    await expect(recordAppError(context)).resolves.toBe(2);

    const exported = await exportAppErrorDiagnostics();
    expect(exported).toBe('file:///cache/psstpsst-diagnostics.json');
    const contents = mockFiles.get(exported!);
    expect(contents).toBeDefined();
    expect(contents).not.toContain('private message content');
    expect(contents).not.toContain('relay.example');
    expect(contents).not.toContain('npub1');
    expect(contents).not.toContain('a'.repeat(64));
    expect(contents).not.toContain('/Users/person');
    expect(contents).not.toContain('C:\\Users\\person');

    const journal = JSON.parse(contents!) as { entries: AppErrorContext[] };
    expect(journal.entries).toHaveLength(2);
    expect(journal.entries[0]).toMatchObject({
      errorName: 'TypeError',
      route: '(app)/chat/[key]',
      appVersion: '1.2.3',
      build: '42',
      platform: 'android',
      platformVersion: '36',
    });
  });

  it('keeps only the latest ten failures', async () => {
    for (let index = 0; index < 12; index += 1) {
      await recordAppError({ ...context, route: `(app)/chat/[key]/${index}` });
    }

    const exported = await exportAppErrorDiagnostics();
    const journal = JSON.parse(mockFiles.get(exported!)!) as { entries: AppErrorContext[] };
    expect(journal.entries).toHaveLength(10);
    expect(journal.entries[0].route).toBe('(app)/chat/[key]/2');
    expect(journal.entries.at(-1)?.route).toBe('(app)/chat/[key]/11');
  });

  const playback = {
    code: 3,
    message: "PipelineStatus::PIPELINE_ERROR_DECODE: https://media.example/it's-private?token=secret",
    currentTime: 2.5,
    duration: 42,
    source: 'attachment' as const,
    appVersion: '1.2.3',
    chromiumVersion: '150.0.0.0',
  };

  it('persists only allowlisted playback details and omits legacy mixed records from exports', async () => {
    mockFiles.set(routeJournalUri, JSON.stringify({
      version: 1,
      entries: [{ ...context, occurredAt: Date.now(), videoPlayback: { message: 'legacy-private-token' } }],
    }));
    const legacyExport = await exportAppErrorDiagnostics();
    expect(mockFiles.get(legacyExport!)).not.toContain('legacy-private-token');

    await recordVideoPlaybackError(playback);
    await recordVideoPlaybackError({ ...playback, message: 'UNKNOWN_ERROR: private-message' });
    const exported = await exportAppErrorDiagnostics();
    const contents = mockFiles.get(exported!)!;
    const journal = JSON.parse(contents);
    expect(journal.entries).toEqual([]);
    expect(journal.videoPlaybackErrors[0]).toEqual({
      occurredAt: expect.any(Number),
      code: 3,
      chromiumError: 'PIPELINE_ERROR_DECODE',
      currentTime: 2.5,
      duration: 42,
      source: 'attachment',
      appVersion: '1.2.3',
      chromiumVersion: '150.0.0.0',
    });
    expect(journal.videoPlaybackErrors[1].chromiumError).toBeUndefined();
    expect(contents).not.toMatch(/token|private|media\.example|UNKNOWN_ERROR/);
    expect(mockFiles.get(playbackJournalUri)).not.toMatch(/token|private|media\.example/);
  });

  it('keeps route recovery and the playback retention limit independent', async () => {
    await expect(recordAppError(context)).resolves.toBe(1);
    const writes = Array.from({ length: 12 }, (_, currentTime) =>
      recordVideoPlaybackError({ ...playback, currentTime }),
    );
    const repeated = recordAppError(context);
    await Promise.all(writes);
    await expect(repeated).resolves.toBe(2);

    const exported = await exportAppErrorDiagnostics();
    const journal = JSON.parse(mockFiles.get(exported!)!);
    expect(journal.entries).toHaveLength(2);
    expect(journal.videoPlaybackErrors).toHaveLength(10);
    expect(journal.videoPlaybackErrors[0].currentTime).toBe(2);
  });

  it('keeps route recovery history when a playback write is interrupted', async () => {
    await expect(recordAppError(context)).resolves.toBe(1);
    const previousRouteJournal = mockFiles.get(routeJournalUri);
    jest.mocked(platform.fileSystem.writeText).mockImplementationOnce(async (uri, contents) => {
      mockFiles.set(uri, contents.slice(0, 8));
      throw new Error('Interrupted write');
    });

    await recordVideoPlaybackError(playback);
    expect(mockFiles.get(routeJournalUri)).toBe(previousRouteJournal);
    const partialPlaybackJournal = mockFiles.get(playbackJournalUri);
    expect(partialPlaybackJournal).toBeDefined();
    expect(() => JSON.parse(partialPlaybackJournal!)).toThrow(SyntaxError);
    await expect(recordAppError(context)).resolves.toBe(2);

    await recordVideoPlaybackError(playback);
    const exported = await exportAppErrorDiagnostics();
    const journal = JSON.parse(mockFiles.get(exported!)!);
    expect(journal.entries).toHaveLength(2);
    expect(journal.videoPlaybackErrors).toHaveLength(1);
  });

  it('drops extra fields from stored playback entries on export and rewrite', async () => {
    const entry = {
      occurredAt: 100,
      code: 3,
      chromiumError: 'PIPELINE_ERROR_DECODE',
      currentTime: 2.5,
      duration: 42,
      source: 'remote',
      appVersion: '1.2.3',
      chromiumVersion: '150.0.0.0',
    };
    mockFiles.set(playbackJournalUri, JSON.stringify({
      version: 1,
      videoPlaybackErrors: [{
        ...entry,
        message: 'Private decoder message',
        url: 'https://media.example/video?token=private',
      }],
    }));

    const exported = await exportAppErrorDiagnostics();
    expect(JSON.parse(mockFiles.get(exported!)!).videoPlaybackErrors).toEqual([entry]);

    await recordVideoPlaybackError(playback);
    expect(JSON.parse(mockFiles.get(playbackJournalUri)!).videoPlaybackErrors[0]).toEqual(entry);
  });

  it('validates stored playback versions and preserves older playback history on migration', async () => {
    const entry = {
      occurredAt: 100,
      code: 3,
      currentTime: 2.5,
      source: 'remote',
    };
    mockFiles.set(routeJournalUri, JSON.stringify({
      version: 1,
      entries: [],
      videoPlaybackErrors: [
        { ...entry, appVersion: 'https://media.example/?token=private', chromiumVersion: 'private-text' },
        { ...entry, appVersion: 123, chromiumVersion: '150.0.0.0\n' },
      ],
    }));

    const exported = await exportAppErrorDiagnostics();
    const safeEntry = { ...entry, appVersion: 'unknown', chromiumVersion: 'unknown' };
    expect(JSON.parse(mockFiles.get(exported!)!).videoPlaybackErrors).toEqual([safeEntry, safeEntry]);

    const previousRouteJournal = mockFiles.get(routeJournalUri);
    await recordVideoPlaybackError({
      ...playback,
      appVersion: '26.11.2-private',
      chromiumVersion: '150.0.0',
    });
    expect(mockFiles.get(routeJournalUri)).toBe(previousRouteJournal);
    expect(JSON.parse(mockFiles.get(playbackJournalUri)!).videoPlaybackErrors).toEqual([
      safeEntry,
      safeEntry,
      expect.objectContaining({ code: 3, appVersion: 'unknown', chromiumVersion: 'unknown' }),
    ]);
  });

  it('fails closed when persistent storage is unavailable', async () => {
    const { platform } = jest.requireMock('@/platform') as {
      platform: { fileSystem: { documentDirectoryUri: jest.Mock } };
    };
    platform.fileSystem.documentDirectoryUri
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    await expect(recordAppError(context)).resolves.toBe(1);
    await expect(exportAppErrorDiagnostics()).resolves.toBeNull();
  });
});
