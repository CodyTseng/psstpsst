import { initPlatformAdapters, platform } from '@/platform';
import { createElectronAdapters } from '..';
import { getElectronBridge } from '../bridge';

jest.mock('../../expo', () => ({
  createExpoAdapters: () => { throw new Error('Electron must not use Expo adapters'); },
}));
jest.mock('../bridge', () => ({ getElectronBridge: jest.fn() }));
jest.mock('../video-thumbnail', () => ({ electronVideoThumbnailAdapter: {} }));

const clipboard = {
  writeText: jest.fn<Promise<void>, [string]>(),
  readText: jest.fn<Promise<string>, []>(),
};
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');

beforeAll(() => {
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { hidden: false, addEventListener: jest.fn() },
  });
  jest.mocked(getElectronBridge).mockReturnValue({ clipboard } as unknown as ReturnType<typeof getElectronBridge>);
  initPlatformAdapters(createElectronAdapters());
});

afterAll(() => {
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else Reflect.deleteProperty(globalThis, 'document');
});

beforeEach(() => {
  jest.resetAllMocks();
  clipboard.writeText.mockResolvedValue(undefined);
  clipboard.readText.mockResolvedValue('');
});

it('copies formatted event JSON through the Electron preload bridge', async () => {
  const json = JSON.stringify({ kind: 14, content: 'Hello 皇上', tags: [] }, null, 2);
  await platform.clipboard.writeText(json);
  expect(clipboard.writeText).toHaveBeenCalledWith(json);
});

it('reads text through the Electron preload bridge', async () => {
  clipboard.readText.mockResolvedValue('lnbc123');
  await expect(platform.clipboard.readText()).resolves.toBe('lnbc123');
});

it('reports native failures to shared clipboard actions', async () => {
  clipboard.writeText.mockRejectedValue(new Error('Clipboard unavailable'));
  clipboard.readText.mockRejectedValue(new Error('Clipboard unavailable'));
  await expect(platform.clipboard.writeText('event')).rejects.toThrow('Clipboard unavailable');
  await expect(platform.clipboard.readText()).rejects.toThrow('Clipboard unavailable');
});
