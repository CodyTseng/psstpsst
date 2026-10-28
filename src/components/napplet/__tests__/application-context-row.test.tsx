import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Platform, View } from 'react-native';
import { ApplicationContextRow } from '../ApplicationContextRow';
import { ApplicationListRow } from '../ApplicationListRow';
import { ApplicationMenu } from '../ApplicationMenu';
import type { ExploreEntry } from '@/services/explore/model';

jest.mock('../ApplicationListRow', () => ({ ApplicationListRow: 'Row' }));
jest.mock('../ApplicationMenu', () => ({ ApplicationMenu: 'Menu' }));
jest.mock('@/lib/haptics', () => ({ impact: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const app: ExploreEntry = { key: 'app', address: 'https://example.com', description: 'Notes app', required: [], title: 'Notes', kind: 'napp', servers: [], desktopPosition: 0, lastUsedAt: 1 };
const onFavorite = jest.fn(), onRemove = jest.fn(), onDetails = jest.fn();
const props = { app, favorite: true, onFavorite, onRemove, onDetails, onPermissions: jest.fn(), onShare: jest.fn() };
let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); jest.restoreAllMocks(); jest.clearAllMocks(); });

it('anchors a browser context menu to the pointer rather than the full row', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  await act(async () => { renderer = create(<ApplicationContextRow {...props} />); });
  const event = { nativeEvent: { clientX: 235, clientY: 180 }, preventDefault: jest.fn(), stopPropagation: jest.fn() };
  await act(async () => { renderer.root.findByType(View).props.onContextMenu(event); });
  expect(event.preventDefault).toHaveBeenCalled();
  expect(renderer.root.findByType(ApplicationMenu).props).toMatchObject({ anchor: { x: 235, y: 180 }, point: true, favorite: true, onFavorite, onRemove });
});

it('anchors a long-press menu to the touch and keeps Remove available on favorited history', async () => {
  await act(async () => { renderer = create(<ApplicationContextRow {...props} />); });
  const row = renderer.root.findByType(ApplicationListRow);
  expect(row.props.accessibilityActions).toContainEqual({ name: 'remove', label: 'applications.remove_from_history' });
  await act(async () => { row.props.onLongPress({ nativeEvent: { pageX: 80, pageY: 320 } }); });
  expect(renderer.root.findByType(ApplicationMenu).props.anchor).toEqual({ x: 80, y: 320 });
  act(() => { row.props.onAccessibilityAction({ nativeEvent: { actionName: 'remove' } }); });
  expect(onRemove).toHaveBeenCalledWith(app);
  expect(onFavorite).not.toHaveBeenCalled();
  act(() => { row.props.onPress(); });
  expect(onDetails).toHaveBeenCalledWith(app);
});

it('omits history removal in discovery while exposing the favorite toggle', async () => {
  await act(async () => { renderer = create(<ApplicationContextRow {...props} onRemove={undefined} favorite={false} />); });
  const row = renderer.root.findByType(ApplicationListRow);
  expect(row.props.accessibilityActions.some((item: { name: string }) => item.name === 'remove')).toBe(false);
  expect(row.props.accessibilityActions).toContainEqual({ name: 'favorite', label: 'applications.add_app' });
  act(() => { row.props.onAccessibilityAction({ nativeEvent: { actionName: 'favorite' } }); });
  expect(onFavorite).toHaveBeenCalledWith(app);
});

it('keeps discovery rows free of membership buttons and opens details on press', async () => {
  await act(async () => { renderer = create(<ApplicationContextRow {...props} favorite={false} />); });
  const row = renderer.root.findByType(ApplicationListRow);
  expect(row.props.trailing).toBeUndefined();
  act(() => { row.props.onPress(); });
  expect(onDetails).toHaveBeenCalledWith(app);
  expect(onFavorite).not.toHaveBeenCalled();
});
