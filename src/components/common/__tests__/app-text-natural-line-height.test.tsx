import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text, type TextStyle } from 'react-native';

import { emojiSize, typography } from '@/theme';

import { AppText } from '../AppText';

jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: { accent: string; preference: string }) => unknown) =>
    selector({ accent: 'blue', preference: 'light' }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));

describe('AppText natural line height', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('omits line height from every style layer for standalone emoji', () => {
    act(() => {
      renderer = create(<AppText naturalLineHeight style={emojiSize.message}>🤗</AppText>);
    });

    // React Native Web retains an earlier numeric line height when a later
    // style layer supplies undefined, so checking only flattened style misses it.
    const styles = renderer!.root.findByType(Text).props.style as TextStyle[];
    expect(styles.every((style) => !Object.hasOwn(style, 'lineHeight'))).toBe(true);
    expect(styles.some((style) => style.fontSize === 80)).toBe(true);
  });

  it('preserves the semantic line height for ordinary text', () => {
    act(() => {
      renderer = create(<AppText variant="body">Message</AppText>);
    });

    const styles = renderer!.root.findByType(Text).props.style as TextStyle[];
    expect(styles[0].lineHeight).toBe(typography.body.lineHeight);
  });
});
