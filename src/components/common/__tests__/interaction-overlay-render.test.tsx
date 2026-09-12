import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';

import { darkPalette, lightPalette } from '@/theme';

import { InteractionOverlay } from '../InteractionOverlay';

const mockThemeState: {
  accent: 'blue';
  preference: 'light' | 'dark';
} = { accent: 'blue', preference: 'light' };

jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: typeof mockThemeState) => unknown) =>
    selector(mockThemeState),
}));

describe('InteractionOverlay', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    mockThemeState.preference = 'light';
  });

  it.each([
    ['light', lightPalette],
    ['dark', darkPalette],
  ] as const)('uses the shared theme overlay in %s mode', (scheme, palette) => {
    mockThemeState.preference = scheme;
    act(() => {
      renderer = create(<InteractionOverlay borderRadius={12} />);
    });

    expect(StyleSheet.flatten(renderer!.root.findByType(View).props.style)).toMatchObject({
      backgroundColor: palette.interactionOverlay,
      borderRadius: 12,
      pointerEvents: 'none',
    });
  });
});
