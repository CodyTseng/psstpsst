import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { router } from 'expo-router';

import AddWalletScreen from '@/app/(app)/wallet-add';
import { walletAuthenticationMode } from '@/services/wallet/wallet-pin.service';
import { addWallet, validateWalletConnectionString } from '@/services/wallet/wallet.service';
import { useWalletConnectionHandoffStore } from '@/stores/wallet-connection-handoff.store';

let mockHandoffId = '';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), dismissTo: jest.fn() },
  useLocalSearchParams: () => ({ handoff: mockHandoffId }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/components/common/AppButton', () => ({ AppButton: () => null }));
jest.mock('@/components/common/AppInput', () => ({ AppInput: () => null }));
jest.mock('@/components/common/AppScreen', () => ({
  AppScreen: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/components/common/QrScanButton', () => ({ QrScanButton: () => null }));
jest.mock('@/components/common/ScreenHeader', () => ({
  ScreenHeader: () => null,
  useScreenHeaderClearance: () => 0,
}));
jest.mock('@/hooks/use-scrolled', () => ({
  useScrolled: () => ({ scrolled: false, scrollProps: {} }),
}));
jest.mock('@/platform', () => ({
  platform: { confirmationDialog: { notify: jest.fn(async () => {}) } },
}));
jest.mock('@/services/profile/profile.service', () => ({ getProfile: jest.fn() }));
jest.mock('@/services/wallet/wallet-pin.service', () => ({
  setWalletPin: jest.fn(),
  walletAuthenticationMode: jest.fn(),
}));
jest.mock('@/services/wallet/wallet.service', () => ({
  addWallet: jest.fn(),
  validateWalletConnectionString: jest.fn(),
}));
jest.mock('@/stores/active-account.store', () => ({
  useActiveAccount: (selector: (state: { activePubkey: string }) => unknown) =>
    selector({ activePubkey: 'account' }),
}));
jest.mock('@/stores/receiving-wallet-prompt.store', () => ({
  useReceivingWalletPromptStore: { getState: () => ({ queue: jest.fn() }) },
}));
jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: { accent: 'blue'; preference: 'light' }) => unknown) =>
    selector({ accent: 'blue', preference: 'light' }),
}));

describe('AddWalletScreen scanner handoff', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    useWalletConnectionHandoffStore.setState({ pending: null });
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('immediately starts the existing add-wallet flow', async () => {
    const connectionString = 'nostr+walletconnect://connection';
    mockHandoffId = String(
      useWalletConnectionHandoffStore.getState().start({
        accountPubkey: 'account',
        connectionString,
      }),
    );
    jest.mocked(walletAuthenticationMode).mockResolvedValueOnce('system');
    jest.mocked(addWallet).mockResolvedValueOnce({
      id: 'wallet',
      lud16: null,
    } as Awaited<ReturnType<typeof addWallet>>);

    act(() => {
      renderer = create(<AddWalletScreen />);
    });
    await act(async () => {
      jest.runOnlyPendingTimers();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(validateWalletConnectionString).toHaveBeenCalledWith(connectionString);
    expect(walletAuthenticationMode).toHaveBeenCalledWith('account');
    expect(addWallet).toHaveBeenCalledWith('account', connectionString);
    expect(router.dismissTo).toHaveBeenCalledWith('/wallet');
    expect(router.back).not.toHaveBeenCalled();
    expect(useWalletConnectionHandoffStore.getState().pending).toBeNull();
  });
});
