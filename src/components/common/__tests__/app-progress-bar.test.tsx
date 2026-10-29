import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { View } from 'react-native';
import { AppProgressBar } from '../AppProgressBar';

let mockColors = { insetFill: 'light-track', accent: 'light-accent' };
jest.mock('@/theme', () => ({
  radius: { full: 9999 }, spacing: { xs: 4 }, useThemeColors: () => mockColors,
}));

it.each(['light', 'dark'])('uses the current %s theme and exposes accessible progress', mode => {
  mockColors = { insetFill: `${mode}-track`, accent: `${mode}-accent` };
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<AppProgressBar value={0.256} label="Downloading app" />); });
  const [track, fill] = renderer.root.findAllByType(View);
  expect(track.props.style.backgroundColor).toBe(mockColors.insetFill);
  expect(fill.props.style.backgroundColor).toBe(mockColors.accent);
  expect(track.props.accessibilityRole).toBe('progressbar');
  expect(track.props.accessibilityLabel).toBe('Downloading app');
  expect(track.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 25 });
  expect(fill.props.style.width).toBe('25%');
  act(() => renderer.unmount());
});
