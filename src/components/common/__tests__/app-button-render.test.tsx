import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { AppButton } from '../AppButton';
import { AppText } from '../AppText';
import { InteractionOverlay } from '../InteractionOverlay';
import { InteractivePressable, resolveInteractiveState } from '../InteractivePressable';
import { darkPalette, lightPalette } from '@/theme';

let mockPreference: 'light' | 'dark' = 'light';

jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: { accent: 'blue'; preference: 'light' | 'dark' }) => unknown) =>
    selector({ accent: 'blue', preference: mockPreference }),
}));

describe('AppButton layout', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    mockPreference = 'light';
  });

  it.each(['text', 'accentText'] as const)(
    'keeps the %s variant at its intrinsic text height',
    (variant) => {
      act(() => {
        renderer = create(<AppButton label="Action" variant={variant} />);
      });

      const pressable = renderer!.root.findByType(InteractivePressable);
      const style = pressable.props.style({ pressed: false });
      expect(style).toMatchObject({ paddingVertical: 0 });
      expect(style).not.toHaveProperty('minHeight');
      expect(pressable.props.hitSlop).toBe(8);
      expect(renderer!.root.findByType(AppText).props.style).toMatchObject({
        includeFontPadding: false,
      });
    },
  );

  it('supports a caption-sized text action without adding control height', () => {
    act(() => {
      renderer = create(
        <AppButton label="Mark all as read" variant="accentText" labelVariant="caption" />,
      );
    });

    const label = renderer!.root.findByType(AppText);
    expect(label.props.variant).toBe('caption');
    expect(label.props.style).toMatchObject({ includeFontPadding: false });
  });

  it('can keep a changing text action to one stable line', () => {
    act(() => {
      renderer = create(
        <AppButton
          label="Switch to a-very-long-name@psstpsst.chat"
          variant="accentText"
          labelNumberOfLines={1}
          labelEllipsizeMode="tail"
        />,
      );
    });

    const label = renderer!.root.findByType(AppText);
    expect(label.props.numberOfLines).toBe(1);
    expect(label.props.ellipsizeMode).toBe('tail');
  });

  it('can align text chrome flush while preserving its hit target', () => {
    act(() => {
      renderer = create(
        <AppButton
          label="Supporting action"
          variant="accentText"
          compact
          compactAxis="none"
        />,
      );
    });

    const pressable = renderer!.root.findByType(InteractivePressable);
    expect(pressable.props.style({ pressed: false })).toMatchObject({
      paddingHorizontal: 0,
      paddingVertical: 0,
    });
    expect(pressable.props.hitSlop).toBe(8);
  });

  it('layers the shared interaction overlay over ghost press feedback', () => {
    act(() => {
      renderer = create(<AppButton accessibilityLabel="Back" variant="ghost" />);
    });

    const pressable = renderer!.root.findByType(InteractivePressable);
    expect(pressable.props.style({ pressed: true })).toMatchObject({
      backgroundColor: 'transparent',
    });
    expect(pressable.props.children({ pressed: true }).props.children[0].type).toBe(
      InteractionOverlay,
    );
  });

  it.each(['primary', 'accentGhost', 'danger'] as const)(
    'keeps the %s fill and layers the shared interaction overlay',
    (variant) => {
      act(() => {
        renderer = create(<AppButton label="Action" variant={variant} />);
      });

      const pressable = renderer!.root.findByType(InteractivePressable);
      expect(pressable.props.style({ pressed: true }).backgroundColor).toBe(
        pressable.props.style({ pressed: false }).backgroundColor,
      );
      expect(pressable.props.children({ pressed: true }).props.children[0].type).toBe(
        InteractionOverlay,
      );
    },
  );

  it.each(['light', 'dark'] as const)(
    'matches the elevated list-row surface for secondary buttons in %s mode',
    (scheme) => {
      mockPreference = scheme;
      const palette = scheme === 'light' ? lightPalette : darkPalette;
      act(() => {
        renderer = create(<AppButton label="Action" variant="secondary" />);
      });

      const pressable = renderer!.root.findByType(InteractivePressable);
      expect(pressable.props.style({ pressed: false })).toMatchObject({
        backgroundColor: palette.surfaceElevated,
        borderColor: palette.border,
        borderWidth: 1,
      });
      expect(pressable.props.style({ pressed: true })).toMatchObject({
        backgroundColor: palette.surfaceElevated,
      });
      expect(pressable.props.children({ pressed: true }).props.children[0].type).toBe(
        InteractionOverlay,
      );
    },
  );

  it.each(['light', 'dark'] as const)('softens amount text without a background in %s mode', (scheme) => {
    mockPreference = scheme;
    act(() => {
      renderer = create(<AppButton label="12,345" labelVariant="amount" variant="text" fullWidth />);
    });

    const pressable = renderer!.root.findByType(InteractivePressable);
    expect(renderer!.root.findByType(AppText).props.style.color).toBe(
      scheme === 'dark' ? darkPalette.text : lightPalette.text,
    );
    expect(pressable.props.style({ pressed: false })).toMatchObject({
      backgroundColor: 'transparent',
      opacity: 1,
    });
    for (const state of [{ pressed: true }, resolveInteractiveState({ pressed: false }, true)]) {
      expect(pressable.props.style(state)).toMatchObject({
        backgroundColor: 'transparent',
        opacity: 0.85,
      });
    }
  });
});
