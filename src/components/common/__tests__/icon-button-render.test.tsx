import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';

import { darkPalette, lightPalette } from '@/theme';

import { AppButton } from '../AppButton';
import { IconButton } from '../IconButton';
import { InteractionOverlay } from '../InteractionOverlay';
import { InteractivePressable } from '../InteractivePressable';

let mockThemePreference: 'light' | 'dark' = 'light';
jest.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' } }) }));
jest.mock('@/lib/platform', () => ({ IS_ELECTRON: true }));
jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: { accent: 'blue'; preference: 'light' | 'dark' }) => unknown) =>
    selector({ accent: 'blue', preference: mockThemePreference }),
}));

describe('Button feedback', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => { mockThemePreference = 'light'; });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('layers the shared interaction overlay over a plain icon press', () => {
    act(() => {
      renderer = create(
        <IconButton accessibilityLabel="Action" icon={<View />} variant="plain" />,
      );
    });

    const pressable = renderer!.root.findByType(InteractivePressable);
    expect(StyleSheet.flatten(pressable.props.style({ pressed: true }))).toMatchObject({
      backgroundColor: 'transparent',
    });
    expect(pressable.props.children({ pressed: true }).props.children[0].type).toBe(
      InteractionOverlay,
    );
  });

  it('uses a solid danger fill for destructive icon actions', () => {
    act(() => {
      renderer = create(
        <IconButton accessibilityLabel="Discard" icon={<View />} variant="danger" />,
      );
    });

    const pressable = renderer!.root.findByType(InteractivePressable);
    const style = pressable.props.style({ pressed: false });
    expect(style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ backgroundColor: lightPalette.danger }),
      ]),
    );
    expect(pressable.props.children({ pressed: true }).props.children[0].type).toBe(
      InteractionOverlay,
    );
  });

  it.each(['light', 'dark'] as const)(
    'matches the elevated list-row surface for secondary icons in %s mode',
    (scheme) => {
      mockThemePreference = scheme;
      const palette = scheme === 'light' ? lightPalette : darkPalette;
      act(() => {
        renderer = create(
          <IconButton accessibilityLabel="Action" icon={<View />} variant="secondary" />,
        );
      });

      const pressable = renderer!.root.findByType(InteractivePressable);
      expect(StyleSheet.flatten(pressable.props.style({ pressed: false }))).toMatchObject({
        backgroundColor: palette.surfaceElevated,
        borderColor: palette.border,
        borderWidth: 1,
      });
      expect(StyleSheet.flatten(pressable.props.style({ pressed: true }))).toMatchObject({
        backgroundColor: palette.surfaceElevated,
      });
      expect(pressable.props.children({ pressed: true }).props.children[0].type).toBe(
        InteractionOverlay,
      );
    },
  );

  it('lightens opaque media controls equally on hover and press in both themes', () => {
    for (const theme of ['light', 'dark'] as const) {
      mockThemePreference = theme;
      const palette = theme === 'light' ? lightPalette : darkPalette;
      act(() => {
        const button = <IconButton accessibilityLabel="Action" icon={<View />} variant="overlay" />;
        if (renderer) renderer.update(button);
        else renderer = create(button);
      });

      const pressable = renderer!.root.findByType(InteractivePressable);
      expect(pressable.props.style({ pressed: false })).toEqual(
        expect.arrayContaining([expect.objectContaining({ backgroundColor: palette.overlayControl })]),
      );
      const activeStyle = expect.arrayContaining([
        expect.objectContaining({ backgroundColor: palette.overlayControlActive }),
      ]);
      expect(pressable.props.style({ pressed: true })).toEqual(activeStyle);
      expect(pressable.props.children({ pressed: true }).props.children[0]).toBeNull();
    }
  });

  it('keeps disabled icons unchanged when hovered or given stale native press state', () => {
    act(() => { renderer = create(<IconButton icon={<View />} variant="overlay" disabled />); });
    const pressable = () => renderer!.root.find((node) => typeof node.props.onPointerEnter === 'function' && typeof node.props.style === 'function');
    const resting = StyleSheet.flatten(pressable().props.style({ pressed: false }));
    act(() => { pressable().props.onPointerEnter({ nativeEvent: { pointerType: 'mouse' } }); });
    expect(StyleSheet.flatten(pressable().props.style({ pressed: true, hovered: true }))).toEqual(resting);
  });

  it('removes existing icon hover feedback as soon as the button becomes disabled', () => {
    const renderButton = (disabled: boolean) => <IconButton icon={<View />} variant="overlay" disabled={disabled} />;
    act(() => { renderer = create(renderButton(false)); });
    const pressable = () => renderer!.root.find((node) => typeof node.props.onPointerEnter === 'function' && typeof node.props.style === 'function');
    const background = () => StyleSheet.flatten(pressable().props.style({ pressed: false })).backgroundColor;
    act(() => { pressable().props.onPointerEnter({ nativeEvent: { pointerType: 'mouse' } }); });
    expect(background()).toBe(lightPalette.overlayControlActive);
    act(() => { renderer!.update(renderButton(true)); });
    expect(background()).toBe(lightPalette.overlayControl);
    act(() => { pressable().props.onPointerLeave({ nativeEvent: { pointerType: 'mouse' } }); });
    act(() => { renderer!.update(renderButton(false)); });
    expect(background()).toBe(lightPalette.overlayControl);
  });

  it.each(['disabled', 'loading'] as const)('suppresses ghost-button hover when %s becomes true', (state) => {
    const renderButton = (inactive: boolean) => <AppButton label="Action" variant="ghost" {...{ [state]: inactive }} />;
    act(() => { renderer = create(renderButton(false)); });
    const pressable = () => renderer!.root.find((node) => typeof node.props.onPointerEnter === 'function' && typeof node.props.style === 'function');
    act(() => { pressable().props.onPointerEnter({ nativeEvent: { pointerType: 'mouse' } }); });
    expect(renderer!.root.findAllByType(InteractionOverlay)).toHaveLength(1);
    act(() => { renderer!.update(renderButton(true)); });
    const disabledStyle = StyleSheet.flatten(pressable().props.style({ pressed: true, hovered: true }));
    expect(disabledStyle.backgroundColor).toBe('transparent');
    expect(disabledStyle.opacity).toBe(0.5);
    expect(renderer!.root.findAllByType(InteractionOverlay)).toHaveLength(0);
  });

});
