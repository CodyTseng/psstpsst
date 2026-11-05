import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { CountBadge } from '@/components/common/CountBadge';
import { NotificationDot } from '@/components/common/NotificationDot';
import { darkPalette, lightPalette } from '@/theme/palette';

let mockColors = lightPalette;
jest.mock('@/components/common/AppText', () => ({ AppText: () => null }));
jest.mock('@/theme', () => ({
  countBadge: { sm: { size: 16, horizontalPadding: 4 }, md: { size: 20, horizontalPadding: 4 } },
  radius: { full: 999 }, useThemeColors: () => mockColors,
}));

it.each([lightPalette, darkPalette])('switches unread requests between counts and dots using theme colors', (colors) => {
  mockColors = colors;
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<CountBadge count={7} />); });
  expect(renderer.root.findByType(AppText).props.children).toBe('7');
  act(() => renderer.update(<CountBadge count={7} mode="dot" />));
  expect(renderer.root.findAllByType(AppText)).toHaveLength(0);
  expect(renderer.root.findByType(NotificationDot).props.tone).toBe('notification');
  expect(StyleSheet.flatten(renderer.root.findByType(View).props.style).backgroundColor).toBe(colors.notification);
  act(() => renderer.update(<CountBadge count={7} mode="dot" tone="neutral" />));
  expect(StyleSheet.flatten(renderer.root.findByType(View).props.style).backgroundColor).toBe(colors.interactionOverlay);
  act(() => renderer.update(<CountBadge count={0} mode="dot" />));
  expect(renderer.toJSON()).toBeNull();
  act(() => renderer.unmount());
});
