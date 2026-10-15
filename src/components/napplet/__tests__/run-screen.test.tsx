import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { NappletSurface } from '@/platform/napplet-surface';
import { router } from 'expo-router';
import NappletRunScreen from '../../../app/(app)/napplet-run';

let mockFocused = true;
let mockSharing = false;
let mockRunning: object | null = { release: { title: 'App' }, containerId: 'test' };
jest.mock('expo-router', () => ({ router: { back: jest.fn() }, useFocusEffect: jest.fn() }));
jest.mock('expo-router/react-navigation', () => ({ useIsFocused: () => mockFocused }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('lucide-react-native/icons/x', () => () => null);
jest.mock('lucide-react-native/icons/ellipsis', () => () => null);
jest.mock('@/components/share/ForwardTargetScreen', () => ({ ForwardTargetScreen: () => null }));
jest.mock('@/components/common/AppScreen', () => ({ AppScreen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/common/ScreenHeader', () => ({ ScreenHeader: () => null, useScreenHeaderClearance: () => 56 }));
jest.mock('@/components/common/IconButton', () => ({ IconButton: () => null }));
jest.mock('@/platform/napplet-surface', () => ({ NappletSurface: () => null }));
jest.mock('@/services/napplet/service', () => ({ nappletService: { stop: jest.fn(), openPanel: jest.fn() } }));
jest.mock('@/stores/napplet.store', () => ({ useNapplets: () => ({ running: mockRunning, launching: false, panel: null, sharing: mockSharing }) }));
jest.mock('@/theme', () => ({ spacing: { xs: 4, lg: 16 }, uiDensity: { iconButtonSize: 32, headerActionIconSize: 20 }, useThemeColors: () => ({ text: 'text' }) }));

it('does not pop the share/profile route when the background app session stops', () => {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<NappletRunScreen />); });
  expect(router.back).not.toHaveBeenCalled();
  mockFocused = false; mockRunning = null;
  act(() => { renderer.update(<NappletRunScreen />); });
  expect(router.back).not.toHaveBeenCalled();
  mockFocused = true;
  act(() => { renderer.update(<NappletRunScreen />); });
  expect(router.back).toHaveBeenCalledTimes(1);
  act(() => renderer.unmount());
});

it('keeps the same app surface mounted while the embedded share picker is open', () => {
  mockFocused = true; mockRunning = { release: { title: 'App' }, containerId: 'original' };
  mockSharing = false;
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<NappletRunScreen />); });
  const original = renderer.root.findByType(NappletSurface);
  mockSharing = true;
  act(() => { renderer.update(<NappletRunScreen />); });
  expect(renderer.root.findByType(NappletSurface)).toBe(original);
  expect(original.props.visible).toBe(false);
  mockSharing = false;
  act(() => { renderer.update(<NappletRunScreen />); });
  expect(renderer.root.findByType(NappletSurface)).toBe(original);
  expect(original.props.visible).toBe(true);
  act(() => renderer.unmount());
});
