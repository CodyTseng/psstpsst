import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { router } from 'expo-router';
import Generate from '@/app/(onboarding)/generate';
import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import { platform } from '@/platform';
import { copyIdentityBackup, discardGeneratedAccount, generateAccountKeyMaterial, persistGeneratedAccount } from '../account.service';

const mockI18n = { t: (key: string) => key };
let mockPreference = 'light';
jest.mock('@/stores/theme.store', () => ({ useThemeStore: (select: (state: unknown) => unknown) => select({ accent: 'blue', preference: mockPreference }) }));
jest.mock('@solar-icons/react-native/category/ui/Linear/Copy', () => ({ Copy: () => null }), { virtual: true });
jest.mock('@solar-icons/react-native/category/security/Linear/ShieldWarning', () => ({ ShieldWarning: () => null }), { virtual: true });
jest.mock('lucide-react-native/icons/check', () => () => null);
jest.mock('@/stores/toast.store', () => ({ showToast: jest.fn() }));
jest.mock('@/platform', () => ({ platform: { confirmationDialog: { notify: jest.fn(async () => {}), confirm: jest.fn(async () => true) } } }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: mockI18n }) }));
jest.mock('../account.service', () => ({ generateAccountKeyMaterial: jest.fn(), copyIdentityBackup: jest.fn(), discardGeneratedAccount: jest.fn(async () => {}), persistGeneratedAccount: jest.fn() }));
jest.mock('@/hooks/use-scrolled', () => ({ useScrolled: () => ({ scrolled: false, scrollProps: {} }) }));
jest.mock('@/components/common/AppButton', () => ({ AppButton: () => null }));
jest.mock('@/components/common/AppText', () => ({ AppText: () => null }));
jest.mock('@/components/common/AppScreen', () => ({ AppScreen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/common/AppContentColumn', () => ({ AppContentColumn: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/onboarding/OnboardingFormLayout', () => ({ OnboardingFormLayout: ({ children }: { children: React.ReactNode }) => children }));

let renderer: ReactTestRenderer;
const pubkey = 'a'.repeat(64);
const buttons = () => renderer.root.findAllByType(AppButton);
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.mocked(generateAccountKeyMaterial).mockResolvedValue({ pubkey, createdAt: 1, key: { role: 'ephemeral', account: pubkey } });
  jest.mocked(persistGeneratedAccount).mockResolvedValue({ pubkey });
});
afterEach(() => {
  act(() => renderer?.unmount());
  jest.useRealTimers();
});

test.each(['light', 'dark'])('private-key backup is explicit and uses the confirmed backup service in %s mode', async preference => {
  mockPreference = preference;
  await act(async () => { renderer = create(<Generate />); });
  const text = renderer.root.findAllByType(AppText).map(node => node.props.children);
  expect(text).toContain('generate.backup_hint');
  expect(text).toContain('generate.continue_hint');
  expect(text).not.toContain(pubkey);
  expect(buttons()[0].props.label).toBe('generate.copy');
  expect(buttons()[1].props.disabled).toBe(true);
  jest.mocked(copyIdentityBackup).mockResolvedValue(true);
  await act(async () => { buttons()[0].props.onPress(); });
  expect(copyIdentityBackup).toHaveBeenCalledWith(pubkey, undefined);
  expect(buttons()[0].props.label).toBe('generate.copied');
  expect(renderer.root.findAllByType(AppText).map(node => node.props.children)).not.toContain('generate.continue_hint');
  expect(buttons()[1].props.disabled).toBe(false);
  act(() => { jest.advanceTimersByTime(2000); });
  expect(buttons()[0].props.label).toBe('generate.copy');
  expect(buttons()[1].props.disabled).toBe(false);
  expect(platform.confirmationDialog.notify).not.toHaveBeenCalled();
  expect(platform.confirmationDialog.confirm).not.toHaveBeenCalled();
  await act(async () => { buttons()[1].props.onPress(); });
  await act(async () => { buttons()[1].props.onPress(); });
  expect(router.push).toHaveBeenCalledTimes(2);
  expect(generateAccountKeyMaterial).toHaveBeenCalledTimes(1);
  expect(discardGeneratedAccount).not.toHaveBeenCalled();
});

test('failed copying keeps continuation disabled and permits retry', async () => {
  await act(async () => { renderer = create(<Generate />); });
  jest.mocked(copyIdentityBackup).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await act(async () => { buttons()[0].props.onPress(); });
  expect(buttons()[1].props.disabled).toBe(true);
  expect(buttons()[0].props.loading).toBe(false);
  expect(platform.confirmationDialog.notify).not.toHaveBeenCalled();
  await act(async () => { buttons()[0].props.onPress(); });
  expect(buttons()[1].props.disabled).toBe(false);
});
