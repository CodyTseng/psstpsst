import { EventEmitter } from 'node:events';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { AppButton } from '@/components/common/AppButton';
import { AppInput } from '@/components/common/AppInput';
import { BottomSheet } from '@/components/common/BottomSheet';
import { ContextMenuOverlay } from '@/components/common/ContextMenu';
import { ListRow } from '@/components/common/ListRow';
import { useMessageExpirySettings } from '@/hooks/use-message-expiry-settings';
import { setMessageExpirySetting } from '@/services/conversation/message-expiry-sync';

import { MessageExpirySetting } from '../message-expiry-setting';

const mockEscapeKeys = new EventEmitter();

jest.mock('lucide-react-native/icons/timer', () => () => null);
jest.mock('lucide-react-native/icons/chevron-down', () => () => null);
jest.mock('react-native/Libraries/Components/View/View', () => ({ default: 'View' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
jest.mock('@/components/common/use-focused-overlay-dismiss', () => ({
  useFocusedOverlayDismiss: (active: boolean, onDismiss: () => void) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(() => {
      if (!active) return;
      mockEscapeKeys.on('keydown', onDismiss);
      return () => { mockEscapeKeys.off('keydown', onDismiss); };
    }, [active, onDismiss]);
  },
}));
jest.mock('@/components/common/ContextMenu', () => ({ ContextMenuOverlay: () => null }));
jest.mock('@/components/common/AppButton', () => ({ AppButton: () => null }));
jest.mock('@/components/common/AppInput', () => ({
  AppInput: ({ trailingAccessory }: { trailingAccessory: React.ReactNode }) => trailingAccessory ?? null,
}));
jest.mock('@/components/common/AppText', () => ({ AppText: () => null }));
jest.mock('@/components/common/BottomSheet', () => ({
  BottomSheet: ({ visible, children, modalOverlay, onClose }: {
    visible: boolean; children: React.ReactNode; modalOverlay: React.ReactNode; onClose: () => void;
  }) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(() => {
      if (!visible) return;
      mockEscapeKeys.on('keyup', onClose);
      return () => { mockEscapeKeys.off('keyup', onClose); };
    }, [visible, onClose]);
    return visible ? <>{children}{modalOverlay}</> : null;
  },
}));
jest.mock('@/components/common/DirectionalChevron', () => ({ DirectionalChevron: () => null }));
jest.mock('@/components/common/ListGroup', () => ({ ListGroup: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/common/ListRow', () => ({ ListRow: () => null }));
jest.mock('@/components/common/radio-indicator', () => ({ RadioIndicator: () => null }));
jest.mock('@/hooks/use-message-expiry-settings', () => ({
  useMessageExpirySettings: jest.fn(() => ({ values: new Map([['', 604800]]), loaded: true })),
}));
jest.mock('@/services/conversation/message-expiry-sync', () => ({ setMessageExpirySetting: jest.fn(async () => {}) }));
jest.mock('@/services/conversation/message-expiry-preference', () => ({
  DEFAULT_MESSAGE_EXPIRY_SLOT: '',
  messageExpiryDuration: (values: Map<string, number> | null, key: string) => values?.get(key) ?? null,
}));
jest.mock('@/i18n/direction', () => ({ useLanguageDirection: () => 'ltr' }));
jest.mock('@/theme', () => ({ useThemeColors: () => ({}), spacing: {}, uiDensity: { inputHeight: 40 } }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: 'en' } }),
}));

it('lists longest presets first and saves a custom per-conversation duration', async () => {
  const peer = 'c'.repeat(64);
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<MessageExpirySetting accountPubkey="self" conversationKey={peer} />, {
    createNodeMock: () => ({
      measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => callback(120, 40, 100, 40),
    }),
  }); });
  try {
    const rows = () => renderer.root.findAllByType(ListRow);
    act(() => { void rows()[0].props.onPress(); });
    expect(rows().slice(1, 7).map(row => row.props.title)).toEqual([
      '4 weeks', '1 week', '1 day', '1 hour', '5 minutes', '30 seconds',
    ]);
    expect(rows().find(row => row.props.title === 'chat.disappearing.use_default')?.props.active).toBe(true);
    const openCustom = () => { rows().find(row => row.props.title === 'chat.disappearing.custom')!.props.onPress(); };
    act(openCustom);
    act(() => { renderer.root.findByType(BottomSheet).props.onHeaderBack(); });
    expect(renderer.root.findAllByType(AppInput)).toHaveLength(0);
    expect(rows().some(row => row.props.title === '4 weeks')).toBe(true);
    expect(setMessageExpirySetting).not.toHaveBeenCalled();
    act(openCustom);
    const input = () => renderer.root.findByType(AppInput).props;
    const selector = () => renderer.root.findByType(AppInput).findByType(AppButton).props;
    const button = (label: string) => renderer.root.findAllByType(AppButton).find(node => node.props.label === label)!.props;
    expect(input().value).toBe('1');
    expect(selector()).toMatchObject({ label: 'week', variant: 'secondary', minimumSize: 40 });
    act(() => { selector().onPress(); });
    expect(selector().accessibilityState.expanded).toBe(true);
    const menu = () => renderer.root.findByType(ContextMenuOverlay).props;
    expect(menu().anchor).toEqual({ x: 220, y: 40, height: 40 });
    expect(menu().items[0]).toMatchObject({ key: 'week', selected: true });
    act(() => { input().onSubmitEditing(); });
    expect(setMessageExpirySetting).not.toHaveBeenCalled();
    act(() => { input().onChangeText('19'); });
    // React Native Web's Modal delivers Escape on keyup, after any keydown handler.
    act(() => { mockEscapeKeys.emit('keydown'); });
    act(() => { mockEscapeKeys.emit('keyup'); });
    expect(selector().accessibilityState.expanded).toBe(false);
    expect(input().value).toBe('19');
    act(() => { input().onChangeText('1'); });
    act(() => { selector().onPress(); });
    const { onPress } = menu().items[1];
    act(() => { menu().onClose(); onPress(); });
    expect(selector().label).toBe('day');
    for (const invalid of ['0', '-2', '1.5', '2,5', '2e3', '2\n', '٠', '-۱۲', '١٫٥']) {
      act(() => { input().onChangeText(invalid); });
      expect(input().value).toBe('1');
    }
    act(() => { input().onChangeText(''); });
    expect(button('common.save').disabled).toBe(true);
    act(() => { input().onSubmitEditing(); });
    expect(setMessageExpirySetting).not.toHaveBeenCalled();
    act(() => { input().onChangeText('٩'); });
    expect(input().value).toBe('9');
    act(() => { input().onChangeText('۱۲'); });
    expect(input().value).toBe('12');
    await act(async () => { input().onSubmitEditing(); });
    expect(setMessageExpirySetting).toHaveBeenCalledWith('self', peer, 12 * 86400);
  } finally {
    act(() => renderer.unmount());
  }
});

it.each([
  [null, null],
  [3600, null],
  [0, 0],
] as const)('shows one Off option when the global default is off and the override is %s', async (override, saved) => {
  const peer = 'c'.repeat(64);
  const values = new Map([['', 0]]);
  if (override !== null) values.set(peer, override);
  jest.mocked(useMessageExpirySettings).mockReturnValue({ values, loaded: true });
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<MessageExpirySetting accountPubkey="self" conversationKey={peer} />); });
  try {
    const rows = () => renderer.root.findAllByType(ListRow);
    expect(rows()[0].props.value).toBe(override === 3600 ? '1 hour' : 'chat.disappearing.off');
    act(() => { rows()[0].props.onPress(); });
    expect(rows().some(row => row.props.title === 'chat.disappearing.use_default')).toBe(false);
    const offRows = rows().filter(row => row.props.title === 'chat.disappearing.off');
    expect(offRows).toHaveLength(1);
    expect(offRows[0].props.active).toBe(override !== 3600);
    await act(async () => { offRows[0].props.onPress(); });
    expect(setMessageExpirySetting).toHaveBeenLastCalledWith('self', peer, saved);
  } finally {
    act(() => renderer.unmount());
  }
});
