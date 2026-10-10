import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { InteractivePressable } from '@/components/common/InteractivePressable';
import { showForwardNotice, forwardNoticeStore } from '@/services/conversation/forward-notice';
import { darkPalette, lightPalette } from '@/theme';
import { ForwardConversationBanner } from '../ForwardConversationBanner';

let mockPreference: 'light' | 'dark' = 'light';
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (href: string, options: unknown) => mockPush(href, options) } }));
jest.mock('@/components/navigation/responsive-stack-router', () => ({ PRIMARY_PANE_RESET_MARKER: () => undefined }));
jest.mock('lucide-react-native/icons/chevron-right', () => () => null);
jest.mock('lucide-react-native/icons/check', () => () => null);
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: unknown) => unknown) => selector({ accent: 'blue', preference: mockPreference }),
}));

const target = { conversationKey: 'target', deliveryKind: 'relay' as const, name: 'Target' };
let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  jest.useFakeTimers();
  mockPush.mockClear();
  showForwardNotice(1, 'account', 'source', [target]);
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  forwardNoticeStore.setState({ notice: null });
  jest.useRealTimers();
});

it.each([
  ['light', lightPalette], ['dark', darkPalette],
] as const)('uses %s theme surfaces with a sent confirmation and trailing conversation shortcut', (preference, palette) => {
  mockPreference = preference;
  act(() => { renderer = create(<ForwardConversationBanner accountPubkey="account" sourceConversationKey="source" />); });
  const card = renderer!.root.findAllByType(InteractivePressable)
    .find((item) => item.props.accessibilityLabel?.includes('share.enter_conversation'))!;
  expect(StyleSheet.flatten(card.props.style)).toMatchObject({
    backgroundColor: palette.surfaceElevated, borderColor: palette.border,
  });
  expect(renderer!.root.findAllByType(AppText).map((item) => item.props.children))
    .toEqual(['share.sent', 'share.enter_conversation']);
  act(() => { card.props.onPress(); });
  expect(mockPush).toHaveBeenCalledWith('/chat/target', { dangerouslySingular: expect.any(Function) });
  expect(forwardNoticeStore.getState().notice).toBeNull();
});

it('hides progress in unrelated conversations and accounts', () => {
  act(() => { renderer = create(<ForwardConversationBanner accountPubkey="other-account" sourceConversationKey="source" />); });
  expect(renderer!.toJSON()).toBeNull();
  act(() => renderer!.update(<ForwardConversationBanner accountPubkey="account" sourceConversationKey="other-source" />));
  expect(renderer!.toJSON()).toBeNull();
});


it('omits names and close controls and expires two seconds after appearing', () => {
  act(() => { renderer = create(<ForwardConversationBanner accountPubkey="account" sourceConversationKey="source" />); });
  expect(renderer!.root.findAllByType(AppText).map((item) => item.props.children))
    .toEqual(['share.sent', 'share.enter_conversation']);
  act(() => { jest.advanceTimersByTime(1999); });
  expect(forwardNoticeStore.getState().notice).not.toBeNull();
  act(() => { jest.advanceTimersByTime(1); });
  expect(forwardNoticeStore.getState().notice).toBeNull();
  expect(mockPush).not.toHaveBeenCalled();
});

it('cleans up the old timer when a newer forward replaces it', () => {
  act(() => { renderer = create(<ForwardConversationBanner accountPubkey="account" sourceConversationKey="source" />); });
  act(() => { jest.advanceTimersByTime(1000); });
  act(() => { showForwardNotice(2, 'account', 'source', [target]); });
  act(() => { jest.advanceTimersByTime(1000); });
  expect(forwardNoticeStore.getState().notice?.id).toBe(2);
  act(() => { jest.advanceTimersByTime(1000); });
  expect(forwardNoticeStore.getState().notice).toBeNull();
});

it('shows one passive sent notice for multiple targets without conversation shortcuts', () => {
  showForwardNotice(1, 'account', 'source', [target, { ...target, conversationKey: 'other' }]);
  act(() => { renderer = create(<ForwardConversationBanner accountPubkey="account" sourceConversationKey="source" />); });
  expect(renderer!.root.findAllByType(AppText).map((item) => item.props.children)).toEqual(['share.sent']);
  expect(renderer!.root.findAllByType(InteractivePressable)).toHaveLength(0);
  const notice = renderer!.root.findAllByType(View).find((item) => item.props.accessibilityLabel === 'share.sent')!;
  expect(notice.props.onPress).toBeUndefined();
  expect(notice.props.accessibilityRole).not.toBe('button');
  act(() => { jest.advanceTimersByTime(2000); });
  expect(forwardNoticeStore.getState().notice).toBeNull();
  expect(mockPush).not.toHaveBeenCalled();
});

it('keeps the banner visible while hovered and expires two seconds after leaving', () => {
  act(() => { renderer = create(<ForwardConversationBanner accountPubkey="account" sourceConversationKey="source" />); });
  act(() => { jest.advanceTimersByTime(1999); });
  act(() => { renderer!.root.findByType(InteractivePressable).props.onHoverIn(); });
  act(() => { jest.advanceTimersByTime(10000); });
  expect(forwardNoticeStore.getState().notice).not.toBeNull();
  act(() => { renderer!.root.findByType(InteractivePressable).props.onHoverOut(); });
  act(() => { jest.advanceTimersByTime(1999); });
  expect(forwardNoticeStore.getState().notice).not.toBeNull();
  act(() => { jest.advanceTimersByTime(1); });
  expect(forwardNoticeStore.getState().notice).toBeNull();
});

it('pauses a passive multi-target notice while hovered and expires two seconds after leaving', () => {
  showForwardNotice(1, 'account', 'source', [target, { ...target, conversationKey: 'other' }]);
  act(() => { renderer = create(<ForwardConversationBanner accountPubkey="account" sourceConversationKey="source" />); });
  const notice = () => renderer!.root.findAllByType(View)
    .find((item) => item.props.accessibilityLabel === 'share.sent')!;
  act(() => { notice().props.onPointerEnter({ nativeEvent: { pointerType: 'mouse' } }); });
  act(() => { jest.advanceTimersByTime(10000); });
  expect(forwardNoticeStore.getState().notice?.targets).toHaveLength(2);
  expect(renderer!.root.findAllByType(InteractivePressable)).toHaveLength(0);
  act(() => { notice().props.onPointerLeave({ nativeEvent: { pointerType: 'mouse' } }); });
  act(() => { jest.advanceTimersByTime(1999); });
  expect(forwardNoticeStore.getState().notice).not.toBeNull();
  act(() => { jest.advanceTimersByTime(1); });
  expect(forwardNoticeStore.getState().notice).toBeNull();
  expect(mockPush).not.toHaveBeenCalled();
});
