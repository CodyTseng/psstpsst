import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';
import { WalletApproval } from '../WalletApproval';
import { ActionRow } from '@/components/common/ActionRow';
import { AppText } from '@/components/common/AppText';
import { AppInput } from '@/components/common/AppInput';
import { WalletAmountDisplay } from '@/components/wallet/WalletAmountDisplay';
import { WalletPaymentConfirmSheet } from '@/components/wallet/WalletPaymentConfirmSheet';
import { nappletService } from '@/services/napplet/service';
import type { QueuedPrompt } from '@/services/napplet/prompt-queue';
import type { WalletApprovalRequest } from '@/lib/wallet/approval';
import { darkPalette, lightPalette } from '@/theme';

let mockScheme: 'light' | 'dark' = 'light';
jest.mock('@/stores/theme.store', () => ({ useThemeStore: (select: (state: object) => unknown) => select({ accent: 'blue', preference: mockScheme }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/services/napplet/service', () => ({ nappletService: { answer: jest.fn() } }));
jest.mock('../NappletIcon', () => ({ NappletIcon: () => null }));
jest.mock('lucide-react-native/icons/chevron-down', () => () => null);
jest.mock('lucide-react-native/icons/check', () => () => null);
jest.mock('@solar-icons/react-native/category/money/Linear/Wallet', () => ({ Wallet: () => null }), { virtual: true });
jest.mock('@/components/common/BottomSheet', () => ({ BottomSheet: ({ children, headerAction }: { children: React.ReactNode; headerAction: React.ReactNode }) => {
  const { View } = jest.requireActual('react-native'); return <View>{headerAction}{children}</View>;
} }));
const review = { operation: 'payment', wallets: [
  { id: 'first', name: 'First', customName: null, isDefault: false },
  { id: 'second', name: 'Second', customName: null, isDefault: true },
], amountMsat: 1234, description: 'Purchase' } satisfies WalletApprovalRequest;
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
it('binds confirmation to the wallet selected in the existing picker', () => {
  render();
  act(() => { renderer.root.findByType(WalletPaymentConfirmSheet).props.onSelectWallet('first'); });
  confirm();
  expect(nappletService.answer).toHaveBeenCalledWith('payment', JSON.stringify({ walletId: 'first' }));
});
it('returns only the selected wallet and finishes dismissal once', () => {
  render(); confirm();
  expect(nappletService.answer).toHaveBeenCalledWith('payment', JSON.stringify({ walletId: 'second' }));
  dismissed(); dismissed();
  expect(closed).toHaveBeenCalledTimes(1);
});
it('rejects cancellation without returning any payment authorization', () => {
  render();
  act(() => { renderer.root.findByType(WalletPaymentConfirmSheet).props.onClose(); });
  expect(nappletService.answer).toHaveBeenCalledWith('payment', false);
  dismissed(); expect(closed).toHaveBeenCalledTimes(1);
});
it('does not approve a request after its host session closes', () => {
  render(prompt, false); confirm();
  expect(nappletService.answer).not.toHaveBeenCalled();
});
it('constrains editable invoice amounts and uses the chosen receiving wallet', () => {
  render({ ...prompt, wallet: { ...review, operation: 'invoice', amountMsat: 1000, amountRange: { min: 1, max: 5 } } });
  act(() => { renderer.root.findByType(AppInput).props.onChangeText('6'); });
  expect(renderer.root.findByType(WalletPaymentConfirmSheet).props.confirmDisabled).toBe(true);
  act(() => { renderer.root.findByType(AppInput).props.onChangeText('3'); });
  confirm();
  expect(nappletService.answer).toHaveBeenCalledWith('payment', JSON.stringify({ walletId: 'second', amountSats: 3 }));
});
