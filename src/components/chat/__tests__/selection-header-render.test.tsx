import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import { darkPalette, lightPalette } from '@/theme';
import { SelectionHeader } from '../SelectionHeader';

let mockPreference: 'light' | 'dark' = 'light';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      key === 'common.cancel' ? 'Cancel' : `${options?.count ?? 0} selected`,
  }),
}));

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
