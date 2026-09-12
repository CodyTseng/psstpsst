import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';

import { darkPalette, lightPalette } from '@/theme';

import { NearbyBadge } from '../NearbyBadge';

jest.mock(
  '@solar-icons/react-native/category/map/Linear/Radar2',
  () => ({ Radar2: jest.fn(() => null) }),
  { virtual: true },
);

const mockThemeState: {
  accent: 'blue';
  preference: 'light' | 'dark';
} = { accent: 'blue', preference: 'light' };

jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: typeof mockThemeState) => unknown) =>
    selector(mockThemeState),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockRadar = jest.requireMock(
  '@solar-icons/react-native/category/map/Linear/Radar2',
).Radar2 as jest.Mock;

describe('NearbyBadge connection status', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    mockRadar.mockClear();
    mockThemeState.preference = 'light';
  });

  it.each([
    {
      status: 'connected' as const,
      background: lightPalette.successSoft,
      icon: lightPalette.success,
    },
    {
      status: 'connecting' as const,
      background: lightPalette.warningSoft,
      icon: lightPalette.warning,
    },
    {
      status: 'disconnected' as const,
      background: lightPalette.interactionOverlay,
      icon: lightPalette.textMuted,
    },
  ])('uses semantic colours while $status', ({ status, background, icon }) => {
    act(() => {
      renderer = create(<NearbyBadge status={status} />);
    });

    const badge = renderer!.root.findAllByType(View).find(
      (candidate) => candidate.props.accessibilityRole === 'image',
    );
    expect(StyleSheet.flatten(badge!.props.style)).toMatchObject({ backgroundColor: background });
    expect(mockRadar).toHaveBeenCalledWith(expect.objectContaining({ color: icon }), undefined);
  });

  it('uses the shared quiet treatment while disconnected in dark mode', () => {
    mockThemeState.preference = 'dark';
    act(() => {
      renderer = create(<NearbyBadge status="disconnected" />);
    });

    const badge = renderer!.root.findAllByType(View).find(
      (candidate) => candidate.props.accessibilityRole === 'image',
    );
    expect(StyleSheet.flatten(badge!.props.style)).toMatchObject({
      backgroundColor: darkPalette.interactionOverlay,
    });
    expect(mockRadar).toHaveBeenCalledWith(
      expect.objectContaining({ color: darkPalette.textMuted }),
      undefined,
    );
  });
});
