import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';

import { darkPalette, lightPalette } from '@/theme';

import { ChromeDivider } from '../ChromeDivider';

let mockPreference: 'light' | 'dark' = 'light';
jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: { accent: 'blue'; preference: 'light' | 'dark' }) => unknown) =>
    selector({ accent: 'blue', preference: mockPreference }),
}));

describe('chrome divider', () => {
  let renderer: ReactTestRenderer | undefined;
  afterEach(() => { act(() => renderer?.unmount()); });

  it.each(['light', 'dark'] as const)('uses the %s border token and does not take layout space', (mode) => {
    mockPreference = mode;
    act(() => { renderer = create(<ChromeDivider visible />); });
    expect(StyleSheet.flatten(renderer!.root.findByType(View).props.style)).toMatchObject({
      backgroundColor: (mode === 'dark' ? darkPalette : lightPalette).border,
      height: StyleSheet.hairlineWidth,
      position: 'absolute',
      bottom: 0,
      start: 0,
      end: 0,
      pointerEvents: 'none',
    });
  });

  it('supports the top of a clipped list and removes the line at rest', () => {
    act(() => { renderer = create(<ChromeDivider visible edge="top" />); });
    const style = StyleSheet.flatten(renderer!.root.findByType(View).props.style);
    expect(style.top).toBe(0);
    expect(style.bottom).toBeUndefined();
    act(() => { renderer?.update(<ChromeDivider visible={false} edge="top" />); });
    expect(renderer!.toJSON()).toBeNull();
  });
});
