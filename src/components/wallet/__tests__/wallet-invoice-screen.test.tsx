import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { router } from 'expo-router';

import WalletInvoiceScreen from '@/app/(app)/wallet-invoice';
import { AppButton } from '@/components/common/AppButton';
import { ExternalInvoicePayment } from '@/components/wallet/external-invoice-payment';

const INVOICE = 'lnbc1u1qpzry9x8gf2tvdw0s3jn54khce6mua7l';
let mockParams: Record<string, string> = { invoice: INVOICE, role: 'received' };

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('lucide-react-native/icons/check', () => () => null);
jest.mock(
  '@solar-icons/react-native/category/ui/Linear/Copy',
  () => ({ Copy: () => null }),
  { virtual: true },
);

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/components/common/ScreenHeader', () => ({
  ScreenHeader: () => null,
  useScreenHeaderClearance: () => 0,
}));
jest.mock('@/components/wallet/WalletPaymentConfirmSheet', () => ({
  WalletPaymentConfirmSheet: () => null,
}));
jest.mock('@/components/wallet/WalletPaymentStatus', () => ({
  WalletPaymentStatus: () => null,
}));
jest.mock('@/components/wallet/external-invoice-payment', () => ({
  ExternalInvoicePayment: () => null,
}));

jest.mock('@/hooks/use-invoice-transaction', () => ({
  useInvoiceTransaction: () => ({ transaction: null, loaded: true }),
}));
jest.mock('@/hooks/use-wallets', () => ({
  useWallets: () => ({
    wallets: [{ id: 'wallet', isDefault: true, name: 'Wallet', customName: null }],
    loaded: true,
  }),
}));

jest.mock('@/lib/clipboard', () => ({ setStringAsync: jest.fn(async () => {}) }));
jest.mock('@/platform', () => ({
  platform: { confirmationDialog: { notify: jest.fn(async () => {}) } },
}));
jest.mock('@/services/wallet/wallet.service', () => ({
  cacheLocalInvoiceTransaction: jest.fn(),
  lookupInvoiceStatus: jest.fn(async () => 'pending'),
  payInvoice: jest.fn(),
  refreshWallet: jest.fn(),
  tryCacheLocalInvoiceTransaction: jest.fn(),
  WalletError: class WalletError extends Error {
    kind = 'payment_failed';
  },
}));
jest.mock('@/stores/active-account.store', () => ({
  useActiveAccount: (selector: (state: { activePubkey: string }) => unknown) =>
    selector({ activePubkey: 'account' }),
}));
jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: { accent: 'blue'; preference: 'light' }) => unknown) =>
    selector({ accent: 'blue', preference: 'light' }),
}));

describe('WalletInvoiceScreen payment options', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    mockParams = { invoice: INVOICE, role: 'received' };
    jest.clearAllMocks();
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  function renderScreen() {
    act(() => {
      renderer = create(<WalletInvoiceScreen />);
    });
  }

  it('opens secondary payment options when a wallet is connected', () => {
    renderScreen();

    expect(renderer!.root.findAllByType(ExternalInvoicePayment)).toHaveLength(0);
    const otherOptions = renderer!.root
      .findAllByType(AppButton)
      .find((button) => button.props.label === 'wallet.other_payment_options');

    act(() => void otherOptions!.props.onPress());

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/wallet-invoice',
      params: { invoice: INVOICE, role: 'received', external: '1' },
    });
  });

  it('shows external payment tools in the secondary view with a connected wallet', () => {
    mockParams = { invoice: INVOICE, role: 'received', external: '1' };
    renderScreen();

    expect(renderer!.root.findByType(ExternalInvoicePayment).props.invoice).toBe(INVOICE);
    expect(
      renderer!.root
        .findAllByType(AppButton)
        .some((button) => button.props.label === 'wallet.continue'),
    ).toBe(false);
  });
});
