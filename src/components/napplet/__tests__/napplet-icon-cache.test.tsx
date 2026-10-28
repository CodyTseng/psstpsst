import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Image } from 'expo-image';
import { NappletIcon } from '../NappletIcon';
import { loadApplicationIcon } from '@/services/explore/icons';
import { peekWebsiteIcon, subscribeWebsiteIcon } from '@/services/explore/website-icons';

jest.mock('expo-image', () => ({ Image: 'CachedImage' }));
jest.mock('@solar-icons/react-native/category/astronomy/Linear/Earth', () => ({ Earth: () => null }), { virtual: true });
jest.mock('@solar-icons/react-native/category/settings/Linear/Widget', () => ({ Widget: () => null }), { virtual: true });
jest.mock('@/theme', () => ({ spacing: { '3xl': 32, lg: 16, xl: 24 }, radius: { xl: 12 },
  useThemeColors: () => ({ surfaceMuted: 'surface', textMuted: 'muted' }) }));
jest.mock('@/services/explore/icons', () => ({
  applicationIconKey: (source: { origin?: string; icon?: { hash: string } }) => source.origin ?? source.icon?.hash ?? '',
  websiteIconOrigin: (source: { origin: string }) => source.origin,
  loadApplicationIcon: jest.fn(),
}));
jest.mock('@/services/explore/website-icons', () => ({
  peekWebsiteIcon: jest.fn(), retryWebsiteIcon: jest.fn(async () => undefined), subscribeWebsiteIcon: jest.fn(),
}));

it('shows the memory-cached local file before asynchronous loading finishes and follows refreshes', async () => {
  const unsubscribe = jest.fn();
  let update!: (uri: string | undefined) => void;
  jest.mocked(peekWebsiteIcon).mockReturnValue('file:///old.png');
  jest.mocked(subscribeWebsiteIcon).mockImplementation((_origin, listener) => { update = listener; return unsubscribe; });
  jest.mocked(loadApplicationIcon).mockImplementation(() => new Promise(() => {}));
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<NappletIcon release={{ origin: 'https://site.example', servers: [] }} />); });
  expect(renderer.root.findByType(Image).props.source).toEqual({ uri: 'file:///old.png' });
  await act(async () => { update('file:///new.png'); });
  expect(renderer.root.findByType(Image).props.source).toEqual({ uri: 'file:///new.png' });
  await act(async () => { renderer.unmount(); });
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

it('defers remote icon work while held and retains loaded artwork when held again', async () => {
  jest.mocked(loadApplicationIcon).mockClear().mockResolvedValue('file:///application.png');
  jest.mocked(peekWebsiteIcon).mockReturnValue(undefined);
  const release = { servers: [], icon: { hash: 'a'.repeat(64), mime: 'image/png' } };
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<NappletIcon release={release} loadRemote={false} />); });
  expect(loadApplicationIcon).not.toHaveBeenCalled();
  await act(async () => { renderer.update(<NappletIcon release={release} />); });
  expect(renderer.root.findByType(Image).props.source).toEqual({ uri: 'file:///application.png' });
  await act(async () => { renderer.update(<NappletIcon release={release} loadRemote={false} />); });
  expect(loadApplicationIcon).toHaveBeenCalledTimes(1);
  expect(renderer.root.findByType(Image).props.source).toEqual({ uri: 'file:///application.png' });
  act(() => renderer.unmount());
});
