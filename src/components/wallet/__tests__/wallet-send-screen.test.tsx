import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { router } from 'expo-router';

import WalletSendScreen from '@/app/(app)/wallet-send';
import { AppButton } from '@/components/common/AppButton';
import { ExternalInvoicePayment } from '@/components/wallet/external-invoice-payment';
import { requestLnurlPayInvoice, resolveLnurlPayTarget } from '@/services/wallet/lnurl';

const INVOICE = 'lnbc1u1qpzry9x8gf2tvdw0s3jn54khce6mua7l';
let mockInput = INVOICE;
let mockWallets: Array<{ id: string; isDefault: boolean; name: string; customName: null }> = [];

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ input: mockInput }),
}));

jest.mock('expo-camera', () => ({
  CameraView: () => null,
  scanFromURLAsync: jest.fn(),
  useCameraPermissions: () => [{ granted: false }, jest.fn()],
}));

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
}));

jest.mock(
  '@solar-icons/react-native/category/notes/Linear/Clipboard',
  () => ({ Clipboard: () => null }),
  { virtual: true },
);
jest.mock(
  '@solar-icons/react-native/category/text-formatting/Linear/Backspace',
  () => ({ Backspace: () => null }),
  { virtual: true },
);
jest.mock(
  '@solar-icons/react-native/category/video/Linear/Gallery',
  () => ({ Gallery: () => null }),
  { virtual: true },
);
jest.mock(
  '@solar-icons/react-native/category/devices/Linear/Keyboard',
  () => ({ Keyboard: () => null }),
  { virtual: true },
);
jest.mock(
  '@solar-icons/react-native/category/messages/Linear/ChatSquare',
  () => ({ ChatSquare: () => null }),
  { virtual: true },
);
jest.mock(
  '@solar-icons/react-native/category/security/Linear/Scanner',
  () => ({ Scanner: () => null }),
  { virtual: true },
);

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/components/common/BottomSheet', () => ({ BottomSheet: () => null }));
jest.mock('@/components/common/ScreenHeader', () => ({
  ScreenHeader: () => null,
  useScreenHeaderClearance: () => 0,
}));
jest.mock('@/components/common/scanner-close-button', () => ({
  ScannerCloseButton: () => null,
}));
jest.mock('@/components/wallet/WalletPaymentStatus', () => ({
  WalletPaymentStatus: () => null,
}));
jest.mock('@/components/wallet/WalletPaymentConfirmSheet', () => ({
  WalletPaymentConfirmSheet: () => null,
}));
jest.mock('@/components/wallet/WalletPinSheet', () => ({ WalletPinSheet: () => null }));
jest.mock('@/components/wallet/external-invoice-payment', () => ({
  ExternalInvoicePayment: () => null,
}));

jest.mock('@/hooks/use-wallets', () => ({
  useWallets: () => ({ wallets: mockWallets, loaded: true }),
}));

jest.mock('@/stores/active-account.store', () => ({
  useActiveAccount: (selector: (state: { activePubkey: string }) => unknown) =>
    selector({ activePubkey: 'account' }),
}));

jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: { accent: 'blue'; preference: 'light' }) => unknown) =>
    selector({ accent: 'blue', preference: 'light' }),
}));

jest.mock('@/platform', () => ({
  platform: { confirmationDialog: { notify: jest.fn(async () => {}) } },
}));

jest.mock('@/services/profile/profile.service', () => ({
  fetchProfile: jest.fn(),
  getProfile: jest.fn(),
}));

jest.mock('@/services/wallet/lnurl', () => {
  const actual = jest.requireActual('@/services/wallet/lnurl');
  return {
    ...actual,
    requestLnurlPayInvoice: jest.fn(),
    resolveLnurlPayTarget: jest.fn(),
  };
});

jest.mock('@/services/wallet/wallet-pin.service', () => ({
  authorizeWalletPin: jest.fn(),
  setWalletPin: jest.fn(),
  walletAuthenticationMode: jest.fn(),
}));

jest.mock('@/services/wallet/wallet.service', () => ({
  payInvoice: jest.fn(),
  WalletError: class WalletError extends Error {
    kind = 'payment_failed';
  },
}));

describe('WalletSendScreen payment options', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
    mockInput = INVOICE;
    mockWallets = [];
    jest.clearAllMocks();
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  async function renderInitialInput() {
    act(() => {
      renderer = create(<WalletSendScreen />);
    });
    await act(async () => {
      jest.runOnlyPendingTimers();
      await Promise.resolve();
    });
  }

  it('offers the invoice to an external wallet', async () => {
    await renderInitialInput();

    expect(renderer!.root.findByType(ExternalInvoicePayment).props.invoice).toBe(INVOICE);
  });

  it('keeps external payment options available with a connected wallet', async () => {
    mockWallets = [{ id: 'wallet', isDefault: true, name: 'Wallet', customName: null }];
    await renderInitialInput();

    const otherOptions = renderer!.root
      .findAllByType(AppButton)
      .find((button) => button.props.label === 'wallet.other_payment_options');

    act(() => void otherOptions!.props.onPress());

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/wallet-invoice',
      params: { invoice: INVOICE, role: 'received', external: '1' },
    });
  });

  it('resolves a payment address to an invoice before external handoff', async () => {
    mockInput = 'hello@example.com';
    jest.mocked(resolveLnurlPayTarget).mockResolvedValueOnce({
      target: mockInput,
      endpoint: 'https://example.com/.well-known/lnurlp/hello',
      callback: 'https://example.com/callback',
      minSendableMsat: 100_000,
      maxSendableMsat: 100_000,
      commentAllowed: 0,
      metadata: '[]',
      description: null,
      domain: 'example.com',
    });
    jest.mocked(requestLnurlPayInvoice).mockResolvedValueOnce({
      invoice: INVOICE,
      amountMsat: 100_000,
      description: null,
      paymentHash: null,
      createdAt: null,
      expiresAt: null,
    });

    await renderInitialInput();

    const continueButton = renderer!.root
      .findAllByType(AppButton)
      .find((button) => button.props.label === 'wallet.continue');
    expect(continueButton?.props.disabled).toBe(false);

    await act(async () => {
      void continueButton!.props.onPress();
      await Promise.resolve();
    });

    expect(requestLnurlPayInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ target: mockInput }),
      100,
      '',
    );
    expect(renderer!.root.findByType(ExternalInvoicePayment).props.invoice).toBe(INVOICE);
  });

  it('resolves a payment address before opening connected-wallet alternatives', async () => {
    mockInput = 'hello@example.com';
    mockWallets = [{ id: 'wallet', isDefault: true, name: 'Wallet', customName: null }];
    jest.mocked(resolveLnurlPayTarget).mockResolvedValueOnce({
      target: mockInput,
      endpoint: 'https://example.com/.well-known/lnurlp/hello',
      callback: 'https://example.com/callback',
      minSendableMsat: 100_000,
      maxSendableMsat: 100_000,
      commentAllowed: 0,
      metadata: '[]',
      description: null,
      domain: 'example.com',
    });
    jest.mocked(requestLnurlPayInvoice).mockResolvedValueOnce({
      invoice: INVOICE,
      amountMsat: 100_000,
      description: null,
      paymentHash: null,
      createdAt: null,
      expiresAt: null,
    });

    await renderInitialInput();

    const otherOptions = renderer!.root
      .findAllByType(AppButton)
      .find((button) => button.props.label === 'wallet.other_payment_options');
    await act(async () => {
      void otherOptions!.props.onPress();
      await Promise.resolve();
    });

    expect(requestLnurlPayInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ target: mockInput }),
      100,
      '',
    );
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/wallet-invoice',
      params: { invoice: INVOICE, role: 'received', external: '1' },
    });
  });
});
