import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';
import { WalletApproval } from '../WalletApproval';
import { ActionRow } from '@/components/common/ActionRow';
import { AppText } from '@/components/common/AppText';
import { AppInput } from '@/components/common/AppInput';
import { BottomSheet } from '@/components/common/BottomSheet';
import { WalletAmountDisplay } from '@/components/wallet/WalletAmountDisplay';
import { WalletPaymentConfirmSheet } from '@/components/wallet/WalletPaymentConfirmSheet';
import { WalletPinSheet } from '@/components/wallet/WalletPinSheet';
import { authorizeWalletPin, consumeWalletPinAuthorization } from '@/services/wallet/wallet-pin.service';
import { nappletService } from '@/services/napplet/service';
import type { QueuedPrompt } from '@/services/napplet/prompt-queue';
import type { WalletApprovalRequest } from '@/lib/wallet/approval';
import { darkPalette, lightPalette } from '@/theme';

let mockScheme: 'light' | 'dark' = 'light';
jest.mock('@/stores/theme.store', () => ({ useThemeStore: (select: (state: object) => unknown) => select({ accent: 'blue', preference: mockScheme }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/services/napplet/service', () => ({ nappletService: { answer: jest.fn() } }));
jest.mock('@/services/wallet/wallet-pin.service', () => ({ authorizeWalletPin: jest.fn(), consumeWalletPinAuthorization: jest.fn() }));
jest.mock('@/components/wallet/WalletPinSheet', () => ({ WalletPinSheet: () => null }));
jest.mock('../SigningRequestDetails', () => ({ SigningAccountAvatar: () => null }));
jest.mock('lucide-react-native/icons/chevron-down', () => () => null);
jest.mock('lucide-react-native/icons/check', () => () => null);
jest.mock('@solar-icons/react-native/category/money/Linear/Wallet', () => ({ Wallet: () => null }), { virtual: true });
jest.mock('@/components/common/BottomSheet', () => ({ BottomSheet: ({ children, headerAction }: { children: React.ReactNode; headerAction: React.ReactNode }) => {
  const { View } = jest.requireActual('react-native'); return <View>{headerAction}{children}</View>;
} }));
const review = { operation: 'payment', wallets: [
  { id: 'first', name: 'First', customName: null, isDefault: false },
  { id: 'second', name: 'Second', customName: null, isDefault: true },
], amountMsat: 1234, description: 'Purchase', authentication: 'system' } satisfies WalletApprovalRequest;
const prompt: QueuedPrompt = { requestId: 'payment', title: 'wallet.confirm_payment', detail: 'Access information', queued: 0,
  expiresAt: Date.now() + 60000, accountPubkey: 'account', requester: { title: 'Site', origin: 'https://site.example' }, wallet: review };
let renderer: ReactTestRenderer;
let closed: jest.Mock;
beforeEach(() => { closed = jest.fn(); });
afterEach(() => { act(() => { renderer?.unmount(); }); jest.clearAllMocks(); });
function render(value = prompt, visible = true) {
  act(() => { renderer = create(<WalletApproval prompt={value} visible={visible} onClosed={closed} />); });
}
function confirm() { act(() => { renderer.root.findByType(WalletPaymentConfirmSheet).props.onConfirm(); }); }
function dismissed() { act(() => { renderer.root.findByType(WalletPaymentConfirmSheet).props.onClosed(); }); }
it.each(['light', 'dark'] as const)('reuses payment UI, source information and exact sats in %s mode', scheme => {
  mockScheme = scheme; render();
  expect(renderer.root.findByType(WalletAmountDisplay).props.amount).toBe('1.234 wallet.sats_unit');
  expect(renderer.root.findByType(WalletPaymentConfirmSheet).props.selectedWalletId).toBe('second');
  expect(renderer.root.findAllByType(AppText).some(node => node.props.children === 'https://site.example')).toBe(true);
  const text = renderer.root.findAllByType(AppText).find(node => node.props.children === 'Purchase')!;
  expect(StyleSheet.flatten(text.findByType(Text).props.style).color).toBe((scheme === 'dark' ? darkPalette : lightPalette).textMuted);
  expect(renderer.root.findByType(ActionRow).props.dismiss).toBeUndefined();
  confirm();
  expect(nappletService.answer).toHaveBeenCalledWith('payment', JSON.stringify({ walletId: 'second' }));
});
it('connects with one approval and no wallet picker or redundant cancel', () => {
  render({ ...prompt, wallet: { operation: 'connect' } });
  expect(renderer.root.findAllByType(WalletPaymentConfirmSheet)).toHaveLength(0);
  expect(renderer.root.findByType(ActionRow).props.dismiss).toBeUndefined();
  const detail = renderer.root.findAllByType(AppText).find(node => node.props.children === prompt.detail)!;
  expect(detail.props.variant).toBe('body');
  act(() => { renderer.root.findByType(ActionRow).props.confirm.onPress(); });
  expect(nappletService.answer).toHaveBeenCalledWith('payment', 'allow');
  act(() => { renderer.root.findByType(BottomSheet).props.onClose(); });
  expect(nappletService.answer).toHaveBeenLastCalledWith('payment', false);
});
it('binds confirmation to the wallet selected in the existing picker', () => {
  render();
  act(() => { renderer.root.findByType(WalletPaymentConfirmSheet).props.onSelectWallet('first'); });
  confirm();
  expect(nappletService.answer).toHaveBeenCalledWith('payment', JSON.stringify({ walletId: 'first' }));
});
it('waits for confirmation dismissal before showing the original PIN sheet', async () => {
  const value = { ...prompt, wallet: { ...review, authentication: 'pin' as const } };
  render(value); confirm();
  expect(renderer.root.findByType(WalletPaymentConfirmSheet).props.visible).toBe(false);
  expect(renderer.root.findAllByType(WalletPinSheet)).toHaveLength(0);
  expect(nappletService.answer).not.toHaveBeenCalled();
  dismissed();
  expect(closed).not.toHaveBeenCalled();
  jest.mocked(authorizeWalletPin).mockResolvedValueOnce(null).mockResolvedValueOnce('one-use-token');
  await act(async () => { expect(await renderer.root.findByType(WalletPinSheet).props.onSubmit('123456')).toBe(false); });
  expect(nappletService.answer).not.toHaveBeenCalled();
  await act(async () => { expect(await renderer.root.findByType(WalletPinSheet).props.onSubmit('654321')).toBe(true); });
  expect(authorizeWalletPin).toHaveBeenLastCalledWith('account', '654321');
  expect(nappletService.answer).toHaveBeenCalledWith('payment', JSON.stringify({ walletId: 'second', pinAuthorization: 'one-use-token' }));
  act(() => { renderer.root.findByType(WalletPinSheet).props.onClose(); });
  expect(nappletService.answer).toHaveBeenCalledTimes(1);
  act(() => { renderer.root.findByType(WalletPinSheet).props.onClosed(); });
  expect(closed).toHaveBeenCalledTimes(1);
});
it('rejects cancellation in the PIN sheet and completes the closing lifecycle', () => {
  render({ ...prompt, wallet: { ...review, authentication: 'pin' } }); confirm(); dismissed();
  act(() => { renderer.root.findByType(WalletPinSheet).props.onClose(); });
  expect(nappletService.answer).toHaveBeenCalledWith('payment', false);
  act(() => { renderer.root.findByType(WalletPinSheet).props.onClosed(); });
  expect(closed).toHaveBeenCalledTimes(1);
});
it('never opens a PIN sheet after cancellation during confirmation dismissal', () => {
  const value = { ...prompt, wallet: { ...review, authentication: 'pin' as const } };
  render(value); confirm();
  act(() => { renderer.update(<WalletApproval prompt={value} visible={false} onClosed={closed} />); });
  dismissed();
  expect(renderer.root.findAllByType(WalletPinSheet)).toHaveLength(0);
  expect(closed).toHaveBeenCalledTimes(1);
});
it('discards a PIN token when the request closes during verification', async () => {
  const value = { ...prompt, wallet: { ...review, authentication: 'pin' as const } };
  render(value); confirm(); dismissed();
  let resolve!: (token: string) => void;
  jest.mocked(authorizeWalletPin).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  let result!: Promise<boolean>;
  act(() => { result = renderer.root.findByType(WalletPinSheet).props.onSubmit('123456'); });
  act(() => { renderer.update(<WalletApproval prompt={value} visible={false} onClosed={closed} />); });
  await act(async () => { resolve('stale-token'); expect(await result).toBe(false); });
  expect(consumeWalletPinAuthorization).toHaveBeenCalledWith('account', 'stale-token');
  expect(nappletService.answer).not.toHaveBeenCalled();
});
it('constrains editable invoice amounts and uses the chosen receiving wallet', () => {
  render({ ...prompt, wallet: { ...review, operation: 'invoice', authentication: undefined, amountMsat: 1000, amountRange: { min: 1, max: 5 } } });
  act(() => { renderer.root.findByType(AppInput).props.onChangeText('6'); });
  expect(renderer.root.findByType(WalletPaymentConfirmSheet).props.confirmDisabled).toBe(true);
  act(() => { renderer.root.findByType(AppInput).props.onChangeText('3'); });
  confirm();
  expect(nappletService.answer).toHaveBeenCalledWith('payment', JSON.stringify({ walletId: 'second', amountSats: 3 }));
});
