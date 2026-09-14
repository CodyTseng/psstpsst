import {
  exportAppErrorDiagnostics,
  recordAppError,
  type AppErrorContext,
} from '../app-error-diagnostics.service';

const mockFiles = new Map<string, string>();

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
