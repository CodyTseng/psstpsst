import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';

import { trySetDevicePreference } from '@/services/preferences/device-preferences.service';
import { useThemeStore } from '@/stores/theme.store';
import { MessageAppearancePreview } from '@/components/chat/MessageAppearancePreview';
import { AppButton } from '../AppButton';
import { AppText } from '../AppText';
import { ACCENTS, type AccentSelection } from '@/theme/accents';
import { SegmentedControl } from '../SegmentedControl';
import { AccentPicker } from '../AccentPicker';
import { AppInput } from '../AppInput';
import { BottomSheet } from '../BottomSheet';
import { IconButton } from '../IconButton';

jest.mock('@/services/preferences/device-preferences.service', () => ({
  getDevicePreference: jest.fn(),
  trySetDevicePreference: jest.fn(async () => {}),
}));
jest.mock('lucide-react-native/icons/check', () => () => null, { virtual: true });
jest.mock('../SegmentedControl', () => ({ SegmentedControl: () => null }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let mockBodyGestures: readonly unknown[];
jest.mock('../BottomSheet', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { Gesture } = jest.requireActual('react-native-gesture-handler');
  const { SheetBodyGestureContext } = jest.requireActual('../sheet-body-gestures');
  return { BottomSheet: ({ children, headerAction, fixedSubheader }: { children: React.ReactNode; headerAction: React.ReactNode; fixedSubheader: React.ReactNode }) => {
    const gestures = React.useMemo(() => [Gesture.Pan(), Gesture.Native()], []);
    mockBodyGestures = gestures;
    return <SheetBodyGestureContext.Provider value={gestures}>{headerAction}{fixedSubheader}{children}</SheetBodyGestureContext.Provider>;
  } };
});
jest.mock('react-native-gesture-handler', () => ({
  ...jest.requireActual('react-native-gesture-handler'),
  GestureDetector: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('react-native-reanimated', () => {
  const React = jest.requireActual('react') as typeof import('react');
  const { View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (component: unknown) => component },
    useSharedValue: (initial: unknown) => React.useRef({
      value: initial,
      get() { return this.value; },
      set(value: unknown) { this.value = value; },
    }).current,
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useAnimatedProps: (factory: () => unknown) => factory(),
  };
});
jest.mock('react-native-worklets', () => ({ scheduleOnRN: (callback: (value: unknown) => void, value: unknown) => callback(value) }));

let renderer: ReactTestRenderer;
function mount(scheme: 'light' | 'dark' = 'light', accent: AccentSelection = 'blue') {
  useThemeStore.getState().setAccent(accent);
  useThemeStore.setState({ preference: scheme, loaded: true });
  jest.clearAllMocks();
  act(() => { renderer = create(<AccentPicker />); });
}
function open() {
  act(() => { renderer.root.findByProps({ accessibilityLabel: 'appearance.customColor' }).props.onPress(); });
}
function done() { return renderer.root.findByType(IconButton); }
function edit(hex: string) {
  act(() => { renderer.root.findByType(AppInput).props.onChangeText(hex); });
}
function finishClose() {
  act(() => { renderer.root.findByType(BottomSheet).props.onClosed(); });
}
afterEach(() => { act(() => renderer?.unmount()); jest.clearAllMocks(); });

it.each(['light', 'dark'] as const)('opens from the final rainbow swatch and commits on Done in %s mode', (scheme) => {
  mount(scheme);
  expect(renderer.root.findAllByType(AppInput)).toHaveLength(0);
  const buttons = renderer.root.findAllByProps({ accessibilityRole: 'button' }).filter((node) => node.props.accessibilityLabel);
  expect(buttons.at(-1)!.props.accessibilityLabel).toBe('appearance.customColor');
  open();
  edit('#abc');
  expect(useThemeStore.getState().accent).toBe('blue');
  expect(trySetDevicePreference).not.toHaveBeenCalled();
  act(() => { done().props.onPress(); });
  expect(useThemeStore.getState().accent).toEqual({ [scheme]: { color: '#AABBCC', foreground: 'white' } });
  expect(renderer.root.findByType(BottomSheet).props.visible).toBe(false);
  finishClose();
  const custom = renderer.root.findByProps({ accessibilityLabel: 'appearance.customColor' });
  expect(custom.props.accessibilityState.selected).toBe(true);
  expect(custom.findAllByType(View).some((node) => StyleSheet.flatten(node.props.style)?.backgroundColor === '#AABBCC')).toBe(true);
});

it('discards cancelled edits and restores the committed colour on reopen', () => {
  mount('light', '#123456');
  open();
  expect(renderer.root.findByType(AppInput).props.value).toBe('#123456');
  edit('#abcdef');
  act(() => { renderer.root.findByType(BottomSheet).props.onClose(); });
  finishClose();
  expect(useThemeStore.getState().accent).toBe('#123456');
  open();
  expect(renderer.root.findByType(AppInput).props.value).toBe('#123456');
});

it('validates HEX edits and ignores an invalid keyboard submit', () => {
  mount();
  open();
  edit('#xyz');
  act(() => { renderer.root.findByType(AppInput).props.onBlur(); });
  expect(renderer.root.findByType(AppInput).props.error).toBe('appearance.invalidColor');
  expect(done().props.disabled).toBe(true);
  act(() => { renderer.root.findByType(AppInput).props.onSubmitEditing(); });
  expect(useThemeStore.getState().accent).toBe('blue');
  expect(renderer.root.findByType(BottomSheet).props.visible).toBe(true);
});

it('synchronizes hue and both colour-plane axes with HEX without applying the theme', () => {
  mount();
  open();
  edit('#FF0000');
  const controls = renderer.root.findAllByType(View).filter((node) => node.props.accessibilityRole === 'adjustable');
  for (const control of controls) {
    act(() => { control.props.onLayout({ nativeEvent: { layout: { width: 300, height: 150 } } }); });
  }
  const [plane, hue] = renderer.root.findAllByType(GestureDetector);
  act(() => { hue.props.gesture.toGestureArray().find((g: { handlerName: string }) => g.handlerName === 'PanGestureHandler').handlers.onStart({ x: 0, y: 75 }); });
  expect(renderer.root.findByType(AppInput).props.value).toBe('#00FFFF');
  act(() => { plane.props.gesture.toGestureArray().find((g: { handlerName: string }) => g.handlerName === 'PanGestureHandler').handlers.onStart({ x: 150, y: 75 }); });
  expect(renderer.root.findByType(AppInput).props.value).toBe('#408080');
  act(() => { plane.props.gesture.toGestureArray().find((g: { handlerName: string }) => g.handlerName === 'PanGestureHandler').handlers.onUpdate({ x: 400, y: -50 }); });
  expect(renderer.root.findByType(AppInput).props.value).toBe('#00FFFF');
  expect(useThemeStore.getState().accent).toBe('blue');
});

it('supports assistive adjustments of hue, brightness and saturation', () => {
  mount();
  open();
  edit('#FF0000');
  const controls = renderer.root.findAllByType(View).filter((node) => node.props.accessibilityRole === 'adjustable');
  act(() => { controls[1].props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }); });
  expect(renderer.root.findByType(AppInput).props.value).toBe('#FF0D00');
  act(() => { controls[0].props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } }); });
  expect(renderer.root.findByType(AppInput).props.value).toBe('#FC0D00');
  act(() => { controls[0].props.onAccessibilityAction({ nativeEvent: { actionName: 'decreaseSaturation' } }); });
  expect(renderer.root.findByType(AppInput).props.value).toBe('#FC0F03');
});

it('gives both click and drag selection precedence over sheet scrolling and dismissal', () => {
  mount();
  open();
  const controls = renderer.root.findAllByType(GestureDetector);
  for (const control of controls) {
    for (const gesture of control.props.gesture.toGestureArray()) {
      expect(gesture.config.blocksHandlers).toEqual(expect.arrayContaining(mockBodyGestures));
    }
  }
  const tap = controls[1].props.gesture.toGestureArray().find((gesture: { handlerName: string }) => gesture.handlerName === 'TapGestureHandler');
  const hueControl = renderer.root.findAllByType(View).find((node) => node.props.accessibilityLabel === 'appearance.hue')!;
  act(() => { hueControl.props.onLayout({ nativeEvent: { layout: { width: 300, height: 40 } } }); });
  edit('#FF0000');
  act(() => { tap.handlers.onEnd({ x: 150, y: 20 }, true); });
  expect(renderer.root.findByType(AppInput).props.value).toBe('#00FFFF');
});

function chooseMode(mode: 'light' | 'dark') {
  act(() => { renderer.root.findAllByType(SegmentedControl)[0].props.onChange(mode); });
}
function selectedForeground() {
  return renderer.root.findAllByType(AppButton).find((node) => node.props.accessibilityState?.checked)?.props.accessibilityLabel === 'appearance.blackForeground' ? 'black' : 'white';
}
function chooseForeground(foreground: 'white' | 'black') {
  act(() => { renderer.root.findByProps({ accessibilityLabel: `appearance.${foreground}Foreground` }).props.onPress(); });
}

it.each(['light', 'dark'] as const)('starts editing the active %s mode using its current colour', (scheme) => {
  mount(scheme);
  open();
  expect(renderer.root.findAllByType(SegmentedControl)[0].props.value).toBe(scheme);
  expect(renderer.root.findByType(AppInput).props.value).toBe(ACCENTS.blue[scheme].accent);
  expect(selectedForeground()).toBe('white');
});

it('shows physical light/dark halves even while the app is in dark mode', () => {
  mount('dark');
  const blue = renderer.root.findByProps({ accessibilityLabel: 'appearance.colors.blue' });
  const halves = blue.findAllByType(View).map((node) => StyleSheet.flatten(node.props.style)).filter((style) => style?.backgroundColor);
  expect(halves.map((style) => style.backgroundColor)).toEqual([ACCENTS.blue.light.accent, ACCENTS.blue.dark.accent]);
});

it('keeps an untouched mode inherited rather than saving a separate colour', () => {
  mount();
  open();
  edit('#FF0000');
  chooseForeground('black');
  chooseMode('dark');
  expect(renderer.root.findByType(AppInput).props.value).toBe('#FF0000');
  expect(selectedForeground()).toBe('black');
  act(() => { done().props.onPress(); });
  expect(useThemeStore.getState().accent).toEqual({ light: { color: '#FF0000', foreground: 'black' } });
  expect(useThemeStore.getState().palettes.dark).toMatchObject({ accent: '#FF0000', accentForeground: '#000000' });
});

it('edits and saves independent per-mode colours and foregrounds atomically', () => {
  mount();
  open();
  edit('#FF0000');
  chooseMode('dark');
  edit('#00FF00');
  chooseForeground('black');
  chooseMode('light');
  expect(renderer.root.findByType(AppInput).props.value).toBe('#FF0000');
  expect(selectedForeground()).toBe('white');
  expect(useThemeStore.getState().preference).toBe('light');
  expect(useThemeStore.getState().accent).toBe('blue');
  act(() => { done().props.onPress(); });
  expect(useThemeStore.getState().accent).toEqual({
    light: { color: '#FF0000', foreground: 'white' }, dark: { color: '#00FF00', foreground: 'black' },
  });
  expect(useThemeStore.getState().palettes.light).toMatchObject({ accent: '#FF0000', accentForeground: '#FFFFFF' });
  expect(useThemeStore.getState().palettes.dark).toMatchObject({ accent: '#00FF00', accentForeground: '#000000' });
  finishClose();
  const custom = renderer.root.findByProps({ accessibilityLabel: 'appearance.customColor' });
  const colors = custom.findAllByType(View).map((node) => StyleSheet.flatten(node.props.style)?.backgroundColor).filter(Boolean);
  expect(colors).toEqual(['#FF0000', '#00FF00']);
  open();
  chooseMode('dark');
  expect(renderer.root.findByType(AppInput).props.value).toBe('#00FF00');
  expect(selectedForeground()).toBe('black');
});

it('retains incomplete HEX input across mode changes and blocks saving either invalid mode', () => {
  mount();
  open();
  chooseMode('dark');
  edit('#123456');
  chooseMode('light');
  edit('#12');
  chooseMode('dark');
  expect(renderer.root.findByType(AppInput).props.value).toBe('#123456');
  expect(done().props.disabled).toBe(true);
  chooseMode('light');
  expect(renderer.root.findByType(AppInput).props.value).toBe('#12');
  edit('#ABCDEF');
  expect(done().props.disabled).toBe(false);
});

it('previews the draft as a sent-message bubble with matching body and metadata foregrounds', () => {
  mount();
  open();
  edit('#FF0000');
  chooseForeground('black');
  const preview = renderer.root.findByType(MessageAppearancePreview);
  expect(preview.props.mode).toBe('light');
  const [body, time] = preview.findAllByType(AppText);
  expect(body.props.variant).toBe('message');
  expect(body.props.children).toBe('appearance.messagePreview');
  expect(body.props.style.color).toBe('#000000');
  expect(time.props.children).toMatch(/^\d{2}:\d{2}$/);
  expect(time.props.style.color).toBe('rgba(0,0,0,0.8)');
  chooseMode('dark');
  expect(renderer.root.findByType(MessageAppearancePreview).props.mode).toBe('dark');
  chooseForeground('white');
  expect(renderer.root.findByType(MessageAppearancePreview).props.colors.accentForeground).toBe('#FFFFFF');
  expect(useThemeStore.getState().accent).toBe('blue');
});
