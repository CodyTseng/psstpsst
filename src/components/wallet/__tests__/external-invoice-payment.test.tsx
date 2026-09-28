import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { View } from 'react-native';

import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import { QrCode } from '@/components/common/QrCode';
import { setStringAsync } from '@/lib/clipboard';
import { platform } from '@/platform';
import { showToast } from '@/stores/toast.store';
import { darkPalette, lightPalette } from '@/theme';

import { ExternalInvoicePayment } from '../external-invoice-payment';

let mockPreference: 'light' | 'dark' = 'light';

jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (
    selector: (state: { accent: 'blue'; preference: 'light' | 'dark' }) => unknown,
  ) => selector({ accent: 'blue', preference: mockPreference }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/components/common/QrCode', () => ({
  QrCode: jest.fn(() => null),
}));

jest.mock('@/platform', () => ({
  platform: { urlOpener: { openExternalUrl: jest.fn(async () => true) } },
}));

jest.mock('@/stores/toast.store', () => ({
  showToast: jest.fn(),
}));

jest.mock('@/lib/clipboard', () => ({
  setStringAsync: jest.fn(async () => {}),
}));

describe('ExternalInvoicePayment', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    mockPreference = 'light';
    jest.clearAllMocks();
  });

  it.each(['light', 'dark'] as const)(
    'shows a scannable Lightning request in %s mode',
    (scheme) => {
      mockPreference = scheme;
      act(() => {
        renderer = create(<ExternalInvoicePayment invoice="lnbc-test-invoice" />);
      });

      expect(renderer!.root.findByType(QrCode).props).toMatchObject({
        data: 'lightning:lnbc-test-invoice',
        size: 216,
      });
      expect(
        renderer!.root
          .findAllByType(View)
          .map((view) => view.props.style?.backgroundColor),
      ).toContain(scheme === 'light' ? lightPalette.onOverlay : darkPalette.onOverlay);
      const paymentRequest = renderer!.root
        .findAllByType(AppText)
        .find((text) => text.props.children === 'lnbc-test-invoice');
      expect(paymentRequest?.props.selectable).toBe(true);
    },
  );

  it('copies the raw payment request', async () => {
    act(() => {
      renderer = create(<ExternalInvoicePayment invoice="lnbc-test-invoice" />);
    });

    const copyButton = renderer!.root
      .findAllByType(AppButton)
      .find((button) => button.props.label === 'wallet.copy_invoice');

    await act(async () => {
      void copyButton!.props.onPress();
      await Promise.resolve();
    });

    expect(setStringAsync).toHaveBeenCalledWith('lnbc-test-invoice');
    expect(
      renderer!.root
        .findAllByType(AppButton)
        .some((button) => button.props.label === 'wallet.copied'),
    ).toBe(true);
  });

  it('hands the request to an installed wallet app', async () => {
    act(() => {
      renderer = create(<ExternalInvoicePayment invoice="lnbc-test-invoice" />);
    });

    const openButton = renderer!.root
      .findAllByType(AppButton)
      .find((button) => button.props.label === 'wallet.open_wallet_app');

    await act(async () => {
      void openButton!.props.onPress();
      await Promise.resolve();
    });

    expect(platform.urlOpener.openExternalUrl).toHaveBeenCalledWith(
      'lightning:lnbc-test-invoice',
    );
    expect(showToast).not.toHaveBeenCalled();
  });

  it('shows a toast when no compatible wallet can open the request', async () => {
    jest.mocked(platform.urlOpener.openExternalUrl).mockResolvedValueOnce(false);
    act(() => {
      renderer = create(<ExternalInvoicePayment invoice="lnbc-test-invoice" />);
    });

    await act(async () => {
      const openButton = renderer!.root
        .findAllByType(AppButton)
        .find((button) => button.props.label === 'wallet.open_wallet_app');
      void openButton!.props.onPress();
      await Promise.resolve();
    });

    expect(showToast).toHaveBeenCalledWith('wallet.open_wallet_failed');
  });
});
