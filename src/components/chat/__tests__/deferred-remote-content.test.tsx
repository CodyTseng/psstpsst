import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { AppButton } from '@/components/common/AppButton';
import { platform } from '@/platform';
import { DeferredRemoteContent } from '../DeferredRemoteContent';

jest.mock('@/components/common/AppButton', () => ({ AppButton: () => null }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/platform', () => ({ platform: { imageCache: {
  getCachedUri: jest.fn(async () => null),
  download: jest.fn(async () => 'file:///downloaded.png'),
} } }));

function Preview({ uri }: { uri: string | null }) { return null; }
let renderer: ReactTestRenderer;
let sequence = 0;
let url: string;
const render = (mode: 'hold' | 'request' | 'auto') => (
  <DeferredRemoteContent mode={mode} url={url}>{(uri) => <Preview uri={uri} />}</DeferredRemoteContent>
);
beforeEach(() => {
  url = `https://example.com/${sequence++}.png`;
  jest.mocked(platform.imageCache.getCachedUri).mockResolvedValue(null);
  jest.mocked(platform.imageCache.download).mockResolvedValue('file:///downloaded.png');
});
afterEach(() => { act(() => renderer?.unmount()); jest.clearAllMocks(); });

it('waits for local lookup and contact resolution before downloading or prompting', async () => {
  let resolve!: (uri: string | null) => void;
  jest.mocked(platform.imageCache.getCachedUri).mockReturnValue(new Promise((done) => { resolve = done; }));
  act(() => { renderer = create(render('hold')); });
  expect(renderer.root.findAllByType(AppButton)).toHaveLength(0);
  act(() => { renderer.update(render('request')); });
  expect(renderer.root.findAllByType(AppButton)).toHaveLength(0);
  await act(async () => { resolve(null); });
  expect(platform.imageCache.download).not.toHaveBeenCalled();
  expect(renderer.root.findByType(Preview).props.uri).toBeNull();
  await act(async () => { renderer.root.findByType(AppButton).props.onPress(); });
  expect(platform.imageCache.download).toHaveBeenCalledTimes(1);
  const preview = renderer.root.findByType(Preview);
  expect(preview.props.uri).toBe('file:///downloaded.png');
  await act(async () => { renderer.update(render('hold')); });
  expect(preview.props.uri).toBe('file:///downloaded.png');
  expect(renderer.root.findAllByType(AppButton)).toHaveLength(0);
  await act(async () => { renderer.unmount(); renderer = create(render('request')); });
  expect(renderer.root.findByType(Preview).props.uri).toBe('file:///downloaded.png');
  expect(renderer.root.findAllByType(AppButton)).toHaveLength(0);
});

it('renders existing disk bytes without a tap or network request', async () => {
  jest.mocked(platform.imageCache.getCachedUri).mockResolvedValue('file:///existing.png');
  await act(async () => { renderer = create(render('request')); });
  expect(renderer.root.findByType(Preview).props.uri).toBe('file:///existing.png');
  expect(renderer.root.findAllByType(AppButton)).toHaveLength(0);
  expect(platform.imageCache.download).not.toHaveBeenCalled();
});

it('does not erase an authorized download when the relationship changes', async () => {
  let finish!: (uri: string) => void;
  jest.mocked(platform.imageCache.download).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  await act(async () => { renderer = create(render('hold')); });
  await act(async () => { renderer.update(render('auto')); });
  expect(platform.imageCache.download).toHaveBeenCalledTimes(1);
  await act(async () => { renderer.update(render('request')); });
  expect(renderer.root.findAllByType(AppButton)).toHaveLength(0);
  await act(async () => { finish('file:///finished.png'); });
  expect(renderer.root.findByType(Preview).props.uri).toBe('file:///finished.png');
  expect(renderer.root.findAllByType(AppButton)).toHaveLength(0);
});

it('rechecks authorization after asynchronous cache lookup', async () => {
  let resolve!: (uri: string | null) => void;
  jest.mocked(platform.imageCache.getCachedUri).mockReturnValue(new Promise((done) => { resolve = done; }));
  act(() => { renderer = create(render('auto')); });
  act(() => { renderer.update(render('request')); });
  await act(async () => { resolve(null); });
  expect(platform.imageCache.download).not.toHaveBeenCalled();
  expect(renderer.root.findAllByType(AppButton)).toHaveLength(1);
});

it('offers another explicit attempt after a failed download', async () => {
  jest.mocked(platform.imageCache.download).mockRejectedValueOnce(new Error('offline'));
  await act(async () => { renderer = create(render('request')); });
  await act(async () => { renderer.root.findByType(AppButton).props.onPress(); });
  expect(renderer.root.findAllByType(AppButton)).toHaveLength(1);
  await act(async () => { renderer.root.findByType(AppButton).props.onPress(); });
  expect(renderer.root.findByType(Preview).props.uri).toBe('file:///downloaded.png');
});


it('updates other mounted occurrences when one resource is downloaded', async () => {
  await act(async () => { renderer = create(<>{render('request')}{render('request')}</>); });
  expect(renderer.root.findAllByType(AppButton)).toHaveLength(2);
  await act(async () => { renderer.root.findAllByType(AppButton)[0].props.onPress(); });
  expect(platform.imageCache.download).toHaveBeenCalledTimes(1);
  expect(renderer.root.findAllByType(AppButton)).toHaveLength(0);
  for (const preview of renderer.root.findAllByType(Preview)) {
    expect(preview.props.uri).toBe('file:///downloaded.png');
  }
});
