import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { AppButton } from '@/components/common/AppButton';
import { IconButton } from '@/components/common/IconButton';
import { AppText } from '@/components/common/AppText';
import { darkPalette, lightPalette } from '@/theme';
import { SelectionHeader } from '../SelectionHeader';
import { SelectionActionBar } from '../SelectionActionBar';

let mockPreference: 'light' | 'dark' = 'light';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      key === 'common.cancel' ? 'Cancel' : options?.count == null ? key : `${options.count} selected`,
  }),
}));

jest.mock('@solar-icons/react-native/category/arrows-action/Linear/Forward',
  () => ({ Forward: () => null }), { virtual: true });
jest.mock('lucide-react-native/icons/trash-2', () => () => null, { virtual: true });
jest.mock('@/components/common/ChromeBackdrop', () => ({ ChromeBackdrop: () => null }));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (
    selector: (state: { accent: 'blue'; preference: 'light' | 'dark' }) => unknown,
  ) => selector({ accent: 'blue', preference: mockPreference }),
}));

describe('SelectionHeader', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    mockPreference = 'light';
  });

  it.each([
    ['light', lightPalette.text],
    ['dark', darkPalette.text],
  ] as const)('renders Cancel as an enabled %s-theme header text action', (preference, color) => {
    mockPreference = preference;
    const onCancel = jest.fn();

    act(() => {
      renderer = create(<SelectionHeader count={2} onCancel={onCancel} />);
    });

    const cancel = renderer!.root.findByType(AppButton);
    expect(cancel.props).toMatchObject({
      label: 'Cancel',
      variant: 'text',
    });
    expect(cancel.findByType(AppText).props.style.color).toBe(color);

    act(() => {
      cancel.props.onPress();
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('SelectionActionBar', () => {
  it.each([
    ['light', lightPalette.danger],
    ['dark', darkPalette.danger],
  ] as const)('places a danger-colored Delete beside Forward in %s mode', (preference, color) => {
    mockPreference = preference;
    const onDelete = jest.fn();
    let renderer: ReactTestRenderer;
    act(() => {
      renderer = create(<SelectionActionBar count={2} onForward={jest.fn()} onDelete={onDelete} />);
    });
    const [forward, remove] = renderer!.root.findAllByType(IconButton);
    expect(forward.props.accessibilityLabel).toBe('chat.actions.forward');
    expect(remove.props).toMatchObject({
      accessibilityLabel: 'common.delete',
      variant: 'dangerSoft',
      disabled: false,
      icon: { props: { color } },
    });
    act(() => { remove.props.onPress(); });
    expect(onDelete).toHaveBeenCalledTimes(1);
    act(() => {
      renderer!.update(<SelectionActionBar count={2} onForward={jest.fn()} onDelete={onDelete} deleteDisabled />);
    });
    expect(renderer!.root.findAllByType(IconButton)[1].props.disabled).toBe(true);
    act(() => renderer!.unmount());
    mockPreference = 'light';
  });
});
