import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';

import { spacing, uiDensity } from '@/theme';

import { IdentityListItem } from '../IdentityListItem';
import { InteractivePressable } from '../InteractivePressable';

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: {
    View: jest.requireActual<typeof import('react-native')>('react-native').View,
  },
  useAnimatedStyle: (resolve: () => object) => resolve(),
}));

jest.mock('@/i18n/direction', () => ({
  ...jest.requireActual('@/i18n/direction'),
  useIsRTL: () => false,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { resolvedLanguage: 'en', language: 'en' } }),
}));

jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: { accent: 'blue' }) => unknown) =>
    selector({ accent: 'blue' }),
}));

jest.mock('@/lib/platform', () => ({
  ...jest.requireActual('@/lib/platform'),
  IS_ELECTRON: true,
}));

describe('IdentityListItem layout', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('uses the shared contact row and leading-visual geometry', () => {
    act(() => {
      renderer = create(
        <IdentityListItem
          leading={(
            <View
              testID="leading"
              style={{
                width: uiDensity.contactAvatarSize,
                height: uiDensity.contactAvatarSize,
              }}
            />
          )}
          title="Group chats"
          onPress={jest.fn()}
        />,
      );
    });

    const row = renderer!.root.findByType(InteractivePressable);
    const rowStyle = StyleSheet.flatten(row.props.style({ pressed: false }));
    const leading = renderer!.root.findByProps({ testID: 'leading' });
    const content = leading.parent;

    expect(rowStyle).toMatchObject({
      height: uiDensity.contactRowHeight,
      paddingStart: spacing.lg,
      paddingEnd: spacing.lg,
    });
    expect(leading.props.style).toMatchObject({
      width: uiDensity.contactAvatarSize,
      height: uiDensity.contactAvatarSize,
    });
    expect(StyleSheet.flatten(content?.props.style)).toMatchObject({
      flexDirection: 'row',
      gap: spacing.md,
    });
  });

  it('keeps a trailing action outside the shrinking identity column', () => {
    act(() => {
      renderer = create(
        <IdentityListItem
          leading={<View />}
          title="Alice"
          trailing={<View testID="trailing" />}
          onPress={jest.fn()}
        />,
      );
    });

    const trailing = renderer!.root.findByProps({ testID: 'trailing' });
    expect(StyleSheet.flatten(trailing.parent?.props.style)).toMatchObject({ flexShrink: 0 });
  });
});
