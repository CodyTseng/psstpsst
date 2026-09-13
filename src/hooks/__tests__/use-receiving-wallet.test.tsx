import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useProfile } from '@/hooks/use-profile';
import { platform } from '@/platform';
import { publishReceivingWalletAddress } from '@/services/wallet/receiving-wallet.service';
import { useReceivingWallet } from '../use-receiving-wallet';

jest.mock('@/hooks/use-profile', () => ({ useProfile: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/platform', () => ({
  platform: { confirmationDialog: { confirm: jest.fn(), notify: jest.fn() } },
}));
jest.mock('@/services/wallet/receiving-wallet.service', () => ({ publishReceivingWalletAddress: jest.fn() }));
jest.mock('@/stores/toast.store', () => ({ showToast: jest.fn() }));

describe('receiving wallet settings', () => {
  let renderer: ReactTestRenderer;
  let result: ReturnType<typeof useReceivingWallet>;

  function Harness() {
    result = useReceivingWallet('account');
    return null;
  }

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    jest.mocked(useProfile).mockReturnValue({
      lud16: 'old@example.com', rawEvent: { id: 'old-event' },
    } as ReturnType<typeof useProfile>);
    jest.mocked(platform.confirmationDialog.confirm).mockResolvedValue(true);
    jest.mocked(publishReceivingWalletAddress).mockResolvedValue(undefined);
    await act(async () => { renderer = create(<Harness />); });
  });

  afterEach(() => {
    act(() => renderer.unmount());
    jest.useRealTimers();
  });

  async function confirm() {
    await act(async () => {
      result.showReceivingWalletConfirmation('wallet', 'new@example.com', 'Cancel');
    });
  }

  it('does not publish when the confirmation is canceled', async () => {
    jest.mocked(platform.confirmationDialog.confirm).mockResolvedValue(false);
    await confirm();
    await act(async () => { jest.runAllTimers(); });
    expect(publishReceivingWalletAddress).not.toHaveBeenCalled();
    expect(result.receivingAddress).toBe('old@example.com');
    expect(result.settingReceivingWalletId).toBeNull();
  });

  it('paints the busy state before publishing and keeps success visible until the profile updates', async () => {
    await confirm();
    expect(result.settingReceivingWalletId).toBe('wallet');
    expect(publishReceivingWalletAddress).not.toHaveBeenCalled();
    await act(async () => { jest.runAllTimers(); });
    expect(publishReceivingWalletAddress).toHaveBeenCalledWith('account', 'new@example.com');
    expect(result.receivingAddress).toBe('new@example.com');
    expect(result.settingReceivingWalletId).toBeNull();

    jest.mocked(useProfile).mockReturnValue({
      lud16: 'later@example.com', rawEvent: { id: 'later-event' },
    } as ReturnType<typeof useProfile>);
    await act(async () => { renderer.update(<Harness />); });
    expect(result.receivingAddress).toBe('later@example.com');
  });

  it('preserves the previous receiving address and allows retry after a failure', async () => {
    jest.mocked(publishReceivingWalletAddress).mockRejectedValueOnce(new Error('offline'));
    await confirm();
    await act(async () => { jest.runAllTimers(); });
    expect(result.receivingAddress).toBe('old@example.com');
    expect(result.settingReceivingWalletId).toBeNull();
    expect(platform.confirmationDialog.notify).toHaveBeenCalled();

    await confirm();
    await act(async () => { jest.runAllTimers(); });
    expect(result.receivingAddress).toBe('new@example.com');
  });
});
