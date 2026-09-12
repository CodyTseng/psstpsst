import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { darkPalette, lightPalette } from '@/theme';

import { ActionMenuPanel } from '../ActionMenuPanel';
import { InteractivePressable } from '../InteractivePressable';

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

describe('ActionMenuPanel interaction feedback', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it.each([
    ['light', lightPalette],
    ['dark', darkPalette],
  ] as const)('uses the shared interaction overlay in %s mode', (scheme, palette) => {
    mockThemeState.preference = scheme;
    act(() => {
      renderer = create(
        <ActionMenuPanel
          items={[{ key: 'first', title: 'First', icon: null, onPress: jest.fn() }]}
        />,
      );
    });

    let row = renderer!.root.findByType(InteractivePressable);
    expect(row.props.style({ pressed: true }).backgroundColor).toBe(palette.interactionOverlay);

    act(() => {
      row.props.onHoverIn();
    });
    row = renderer!.root.findByType(InteractivePressable);
    expect(row.props.style({ pressed: false }).backgroundColor).toBe(palette.interactionOverlay);
  });
});
