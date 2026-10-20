import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ApplicationDetailsActions } from '../ApplicationDetailsActions';
import { HeaderActionMenu } from '@/components/common/HeaderActionMenu';
import { showToast } from '@/stores/toast.store';
import type { ExploreEntry } from '@/services/explore/model';

const mockCopy = jest.fn();
jest.mock('@/hooks/use-clipboard', () => ({ useClipboard: () => ({ copyText: mockCopy }) }));
jest.mock('@/stores/toast.store', () => ({ showToast: jest.fn() }));
jest.mock('@/components/common/HeaderActionMenu', () => ({ HeaderActionMenu: 'Menu', HEADER_ACTION_MENU_ICON_SIZE: 20 }));
jest.mock('@/components/common/IconButton', () => ({ IconButton: 'Button' }));
jest.mock('lucide-react-native/icons/ellipsis', () => () => null);
jest.mock('lucide-react-native/icons/copy', () => () => null);
jest.mock('@solar-icons/react-native/category/ui/Linear/Share', () => ({ Share: () => null }), { virtual: true });
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/theme', () => ({ spacing: { xs: 4 }, iconStrokeWidth: { default: 1.5 },
  uiDensity: { headerActionSize: 36, headerActionIconSize: 20 }, useThemeColors: () => ({ text: 'text' }) }));

let renderer: ReactTestRenderer;
beforeEach(() => { jest.clearAllMocks(); mockCopy.mockReset().mockResolvedValue(true); });
afterEach(() => { act(() => renderer?.unmount()); });

it.each(['napplet', 'napp', 'nsite', 'website'] as const)('copies the canonical %s link and shares through the existing action', async kind => {
  const onShare = jest.fn();
  const entry = { key: 'app', title: 'A title', kind, address: kind === 'website' ? 'https://example.com/' : 'naddr1example' } as ExploreEntry;
  act(() => { renderer = create(<ApplicationDetailsActions entry={entry} onShare={onShare} />); });
  const items = renderer.root.findByType(HeaderActionMenu).props.items;
  await act(async () => { items.find((item: { key: string }) => item.key === 'copy').onPress(); });
  expect(mockCopy).toHaveBeenCalledWith(kind === 'website' ? entry.address : `nostr:${entry.address}`);
  expect(showToast).toHaveBeenCalledWith('common.copied', { target: 'detail' });
  act(() => { items.find((item: { key: string }) => item.key === 'share').onPress(); });
  expect(onShare).toHaveBeenCalledTimes(1);
});

it('offers copy alone when sharing is unavailable', () => {
  act(() => { renderer = create(<ApplicationDetailsActions entry={{ kind: 'website', address: 'https://example.com/' } as ExploreEntry} />); });
  expect(renderer.root.findByType(HeaderActionMenu).props.items.map((item: { key: string }) => item.key)).toEqual(['copy']);
});

it('does not report success after a failed clipboard write', async () => {
  mockCopy.mockResolvedValue(false);
  act(() => { renderer = create(<ApplicationDetailsActions entry={{ kind: 'website', address: 'https://example.com/' } as ExploreEntry} />); });
  await act(async () => { renderer.root.findByType(HeaderActionMenu).props.items[0].onPress(); });
  expect(showToast).not.toHaveBeenCalled();
});
