import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { router } from 'expo-router';
import { AppInput } from '@/components/common/AppInput';
import { QrScanButton } from '@/components/common/QrScanButton';
import { exploreService } from '@/services/explore/service';
import NappletInstallScreen from '../../../app/(app)/napplet-install';

jest.mock('@/platform', () => ({ platform: { napplet: {} } }));
jest.mock('@/services/explore/windows', () => ({ openApplicationWindow: jest.fn() }));

jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/common/AppScreen', () => ({ AppScreen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/common/ScreenHeader', () => ({ ScreenHeader: () => null, useScreenHeaderClearance: () => 56 }));
jest.mock('@/components/common/AppText', () => ({ AppText: () => null }));
jest.mock('@/components/common/AppInput', () => ({ AppInput: () => null }));
jest.mock('@/components/common/AppButton', () => ({ AppButton: () => null }));
jest.mock('@/components/common/QrScanButton', () => ({ QrScanButton: () => null }));
jest.mock('@/services/explore/service', () => ({
  exploreService: { resolve: jest.fn() }, nappletStore: { setState: jest.fn() },
}));
jest.mock('@/theme', () => ({ spacing: { lg: 16 }, useThemeColors: () => ({ danger: 'danger' }) }));

let renderer: ReactTestRenderer;
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(exploreService.resolve).mockResolvedValue({ release: { event: { id: 'verified-event' } } } as Awaited<ReturnType<typeof exploreService.resolve>>);
  act(() => { renderer = create(<NappletInstallScreen />); });
});
afterEach(() => { act(() => renderer.unmount()); });

it('uses a single-line address field and submits keyboard input', async () => {
  expect(renderer.root.findByType(AppInput).props.multiline).toBeFalsy();
  act(() => { renderer.root.findByType(AppInput).props.onChangeText('nostr:naddr1example'); });
  await act(async () => renderer.root.findByType(AppInput).props.onSubmitEditing());
  expect(exploreService.resolve).toHaveBeenCalledWith('nostr:naddr1example');
  expect(router.replace).toHaveBeenCalledWith({ pathname: '/napplet/[id]', params: { id: 'verified-event' } });
});

it('fills and resolves scanned input through the same verified lookup', async () => {
  const scan = renderer.root.findByType(AppInput).props.trailingAccessory;
  expect(scan.type).toBe(QrScanButton);
  await act(async () => scan.props.onScanned('nostr:naddr1scanned'));
  expect(renderer.root.findByType(AppInput).props.value).toBe('nostr:naddr1scanned');
  expect(exploreService.resolve).toHaveBeenCalledWith('nostr:naddr1scanned');
  expect(router.replace).toHaveBeenCalledWith({ pathname: '/napplet/[id]', params: { id: 'verified-event' } });
});

it('keeps an invalid scan editable without navigating', async () => {
  jest.mocked(exploreService.resolve).mockRejectedValueOnce(new Error('napplets.not_found'));
  await act(async () => renderer.root.findByType(AppInput).props.trailingAccessory.props.onScanned('invalid'));
  expect(renderer.root.findByType(AppInput).props.value).toBe('invalid');
  expect(renderer.root.findByType(AppInput).props.editable).toBe(true);
  expect(router.replace).not.toHaveBeenCalled();
});
