import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { TextInput, View } from 'react-native';

import { AppInput } from '../AppInput';
import { AppText } from '../AppText';

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
});
