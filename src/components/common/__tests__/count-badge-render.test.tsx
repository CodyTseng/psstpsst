import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';

import { darkPalette, density, lightPalette } from '@/theme';

import { AppText } from '../AppText';
import { CountBadge } from '../CountBadge';

const mockThemeState: {
  accent: 'blue';
  preference: 'light' | 'dark';
} = { accent: 'blue', preference: 'light' };

jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: typeof mockThemeState) => unknown) =>
    selector(mockThemeState),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));

describe('CountBadge layout', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    mockThemeState.preference = 'light';
  });

  it('uses a roomier small badge on mobile than Electron', () => {
    expect(density.mobile.countBadge.sm.size).toBe(18);
    expect(density.desktop.countBadge.sm.size).toBe(16);
  });

  it.each([
    ['sm', 18, 4],
    ['md', 20, 6],
  ] as const)('uses the %s geometry token', (size, expectedSize, expectedPadding) => {
    act(() => {
      renderer = create(<CountBadge count={7} size={size} />);
    });

    const badge = renderer!.root.findByType(View);
    expect(StyleSheet.flatten(badge.props.style)).toMatchObject({
      minWidth: expectedSize,
      height: expectedSize,
      paddingHorizontal: expectedPadding,
      alignSelf: 'center',
      alignItems: 'center',
      justifyContent: 'center',
    });
    expect(renderer!.root.findByType(AppText).props.align).toBe('center');
  });

  it.each([
    ['light', lightPalette],
    ['dark', darkPalette],
  ] as const)('keeps a muted unread badge quiet in %s mode', (scheme, palette) => {
    mockThemeState.preference = scheme;
    act(() => {
      renderer = create(<CountBadge count={7} tone="neutral" size="sm" />);
    });

    const badge = renderer!.root.findByType(View);
    expect(StyleSheet.flatten(badge.props.style)).toMatchObject({
      backgroundColor: palette.interactionOverlay,
    });
    expect(StyleSheet.flatten(renderer!.root.findByType(AppText).props.style)).toMatchObject({
      color: palette.textMuted,
    });
  });
});
