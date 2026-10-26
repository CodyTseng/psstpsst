import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { router } from 'expo-router';
import LoginNsec from '@/app/(onboarding)/login-nsec';
import { AppInput } from '@/components/common/AppInput';
import { AppButton } from '@/components/common/AppButton';
import { importAccountIdentity } from '../account.service';

const mockSetActive = jest.fn(async () => {});
jest.mock('@/stores/theme.store', () => ({ useThemeStore: (select: (state: unknown) => unknown) => select({ accent: 'blue', preference: 'light' }) }));
jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../account.service', () => ({ importAccountIdentity: jest.fn() }));
jest.mock('@/stores/active-account.store', () => ({ useActiveAccount: (select: (state: unknown) => unknown) => select({ setActive: mockSetActive }) }));
jest.mock('@/hooks/use-scrolled', () => ({ useScrolled: () => ({ scrolled: false, scrollProps: {} }) }));
jest.mock('@/hooks/use-focus-after-transition', () => ({ useFocusAfterTransition: () => ({ current: null }) }));
jest.mock('@/components/common/AppInput', () => ({ AppInput: () => null }));
jest.mock('@/components/common/AppButton', () => ({ AppButton: () => null }));
jest.mock('@/components/common/AppText', () => ({ AppText: () => null }));
jest.mock('@/components/common/AppScreen', () => ({ AppScreen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/common/AppContentColumn', () => ({ AppContentColumn: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/common/AppFormScrollView', () => ({ AppFormScrollView: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/onboarding/OnboardingFormLayout', () => ({ OnboardingFormLayout: ({ children }: { children: React.ReactNode }) => children }));

let renderer: ReactTestRenderer;
beforeEach(() => jest.clearAllMocks());
afterEach(() => act(() => renderer?.unmount()));

test('submitting input clears the form and switches accounts using only public result metadata', async () => {
  jest.mocked(importAccountIdentity).mockResolvedValueOnce({ pubkey: 'public-identity' });
  act(() => { renderer = create(<LoginNsec />); });
  act(() => { renderer.root.findByType(AppInput).props.onChangeText('synthetic-nsec'); });
  await act(async () => { await renderer.root.findByType(AppButton).props.onPress(); });
  expect(importAccountIdentity).toHaveBeenCalledWith('synthetic-nsec');
  expect(renderer.root.findByType(AppInput).props.value).toBe('');
  expect(mockSetActive).toHaveBeenCalledWith('public-identity');
  expect(router.replace).toHaveBeenCalledWith('/');
});

test('a failed import clears the submitted input and allows another attempt', async () => {
  jest.mocked(importAccountIdentity).mockRejectedValueOnce(new Error('Import failed'));
  act(() => { renderer = create(<LoginNsec />); });
  act(() => { renderer.root.findByType(AppInput).props.onChangeText('invalid'); });
  await act(async () => { await renderer.root.findByType(AppButton).props.onPress(); });
  expect(renderer.root.findByType(AppInput).props.value).toBe('');
  expect(renderer.root.findByType(AppInput).props.error).toBe('login.nsec.invalid');
  expect(mockSetActive).not.toHaveBeenCalled();
  expect(router.replace).not.toHaveBeenCalled();
  expect(renderer.root.findByType(AppButton).props.loading).toBe(false);
});
