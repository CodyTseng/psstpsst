import { createRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppInput } from '../AppInput';
import { AppText } from '../AppText';

jest.mock('react-native/Libraries/Components/Pressable/Pressable', () => ({ default: 'InputShell' }));

jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: { accent: 'blue' }) => unknown) =>
    selector({ accent: 'blue' }),
}));

describe('AppInput field chrome', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it.each([true, false])('focuses shell clicks only when editable is %s', editable => {
    const ref = createRef<TextInput>();
    act(() => {
      renderer = create(<AppInput ref={ref} multiline editable={editable} />, {
        createNodeMock: () => ({ focus: jest.fn() }),
      });
    });
    expect(ref.current).toBeTruthy();
    const focus = jest.spyOn(ref.current!, 'focus').mockImplementation(() => {});
    focus.mockClear();
    act(() => { renderer!.root.findByType(Pressable).props.onPress(); });
    expect(focus).toHaveBeenCalledTimes(editable ? 1 : 0);
    expect(renderer!.root.findByType(Pressable).props.accessible).toBe(false);
  });

  it('renders supporting copy below the field as a muted caption', () => {
    act(() => {
      renderer = create(<AppInput description="Supporting copy" />);
    });

    const description = renderer!.root.findByType(AppText);
    expect(description.props).toMatchObject({ variant: 'caption', tone: 'muted' });
    expect(description.props.children).toBe('Supporting copy');
  });

  it('uses the same description slot and danger tone for an invalid field', () => {
    act(() => {
      renderer = create(<AppInput invalid description="Validation error" />);
    });

    expect(renderer!.root.findByType(AppText).props).toMatchObject({
      variant: 'caption',
      tone: 'danger',
      children: 'Validation error',
    });
  });

  it('renders a muted label above the input and uses it for accessibility', () => {
    act(() => {
      renderer = create(<AppInput label="Public key" description="Supporting copy" />);
    });

    const copy = renderer!.root.findAllByType(AppText);
    expect(copy.map((item) => item.props.children)).toEqual(['Public key', 'Supporting copy']);
    expect(copy[0].props).toMatchObject({ variant: 'caption', tone: 'muted' });
    expect(renderer!.root.findByType(TextInput).props.accessibilityLabel).toBe('Public key');
  });

  it('lets an error replace the description and mark the field invalid', () => {
    act(() => {
      renderer = create(<AppInput description="Supporting copy" error="Validation error" />);
    });

    const description = renderer!.root.findByType(AppText);
    expect(description.props).toMatchObject({
      tone: 'danger',
      children: 'Validation error',
    });
  });

  it('keeps a trailing action inside the shared field layout', () => {
    act(() => {
      renderer = create(<AppInput trailingAccessory={<View testID="field-action" />} />);
    });

    expect(renderer!.root.findByProps({ testID: 'field-action' })).toBeTruthy();
    expect(renderer!.root.findByType(TextInput)).toBeTruthy();
  });

  it('renders a compact action inside the input shell', () => {
    act(() => {
      renderer = create(<AppInput inputTrailingAccessory={<View testID="input-action" />} />);
    });

    const action = renderer!.root.findByProps({ testID: 'input-action' });
    expect(StyleSheet.flatten(action.parent?.props.style)).toMatchObject({ flexShrink: 0 });
  });

  it('ellipsizes single-line placeholders by default', () => {
    act(() => {
      renderer = create(<AppInput placeholder="A long placeholder" />);
    });

    const input = renderer!.root.findByType(TextInput);
    const placeholder = renderer!.root.findByType(AppText);

    expect(input.props).toMatchObject({
      multiline: false,
      numberOfLines: 1,
      accessibilityLabel: 'A long placeholder',
    });
    expect(input.props.placeholder).toBeUndefined();
    expect(placeholder.props).toMatchObject({
      children: 'A long placeholder',
      numberOfLines: 1,
      ellipsizeMode: 'tail',
    });

    act(() => {
      input.props.onChangeText('value');
    });

    expect(renderer!.root.findAllByType(AppText)).toHaveLength(0);
  });

  it('preserves the requested line count for multiline fields', () => {
    act(() => {
      renderer = create(
        <AppInput multiline numberOfLines={4} placeholder="A multiline placeholder" />,
      );
    });

    expect(renderer!.root.findByType(TextInput).props).toMatchObject({
      multiline: true,
      numberOfLines: 4,
      placeholder: 'A multiline placeholder',
    });
  });

  it('aligns a centered placeholder with the editable text', () => {
    act(() => {
      renderer = create(
        <AppInput placeholder="22:00" style={[{ textAlign: 'center' }]} />,
      );
    });

    expect(StyleSheet.flatten(renderer!.root.findByType(AppText).props.style)).toMatchObject({
      textAlign: 'center',
    });
    expect(StyleSheet.flatten(renderer!.root.findByType(TextInput).props.style)).toMatchObject({
      textAlign: 'center',
      paddingStart: 0,
      paddingEnd: 0,
    });
  });

  it('bounds the placeholder to the editable area before an inline action', () => {
    act(() => {
      renderer = create(
        <AppInput
          placeholder="A long placeholder"
          inputTrailingAccessory={<View testID="input-action" />}
        />,
      );
    });

    const editableArea = renderer!.root.findAllByType(View).find(
      (view) => StyleSheet.flatten(view.props.style)?.minWidth === 0,
    )!;
    const placeholder = editableArea.findByType(AppText);

    expect(editableArea.findAllByType(TextInput)).toHaveLength(1);
    expect(editableArea.findAllByProps({ testID: 'input-action' })).toHaveLength(0);
    expect(StyleSheet.flatten(placeholder.parent?.props.style)).toMatchObject({
      insetInline: 0,
    });
  });
});
