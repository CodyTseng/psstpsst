import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { TextInput } from 'react-native';

import { SearchBar } from '../SearchBar';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock(
  '@solar-icons/react-native/category/search/Linear/Magnifer',
  () => ({ Magnifer: () => null }),
  { virtual: true },
);
jest.mock('lucide-react-native/icons/x', () => () => null, { virtual: true });
jest.mock('react-native-reanimated', () => {
  const transition = { duration: () => transition };
  return {
    __esModule: true,
    default: { View: 'Animated.View' },
    FadeIn: transition,
    LinearTransition: transition,
  };
});
jest.mock('@/components/search/SearchTransition', () => ({
  SEARCH_ACTIVATION_TRANSITION_MS: 250,
}));
jest.mock('@/lib/platform', () => ({ IS_IOS: false }));
jest.mock('@/theme/icons', () => ({ iconStrokeWidth: { default: 2 } }));
jest.mock('@/theme', () => ({
  radius: { md: 12 },
  spacing: { md: 12 },
  typography: { body: { fontSize: 16, lineHeight: 20, fontFamily: undefined } },
  uiDensity: { searchBarHeight: 40 },
  useThemeColors: () => ({
    accent: 'accent',
    background: 'background',
    surfaceMuted: 'surface-muted',
    text: 'text',
    textMuted: 'text-muted',
  }),
}));

describe('SearchBar transition', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => jest.useFakeTimers());

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    jest.useRealTimers();
  });

  it('retains its text input while switching between resting and editable modes', () => {
    const onChangeText = jest.fn();
    const onPress = jest.fn();

    act(() => {
      renderer = create(
        <SearchBar
          value=""
          onChangeText={onChangeText}
          placeholder="Search"
          onPress={onPress}
        />,
      );
    });

    const restingInput = renderer!.root.findByType(TextInput);
    expect(restingInput.props.editable).toBe(false);

    act(() => {
      renderer!.update(
        <SearchBar
          value=""
          onChangeText={onChangeText}
          placeholder="Search"
        />,
      );
      jest.runOnlyPendingTimers();
    });

    const editableInput = renderer!.root.findByType(TextInput);
    expect(editableInput).toBe(restingInput);
    expect(editableInput.props.editable).toBe(true);

    act(() => {
      renderer!.update(
        <SearchBar
          value=""
          onChangeText={onChangeText}
          placeholder="Search"
          onPress={onPress}
        />,
      );
      jest.runOnlyPendingTimers();
    });

    expect(renderer!.root.findByType(TextInput)).toBe(restingInput);
    expect(renderer!.root.findByType(TextInput).props.editable).toBe(false);
  });

  it('shows the focus border without replacing the field', () => {
    act(() => {
      renderer = create(
        <SearchBar
          value=""
          onChangeText={jest.fn()}
          placeholder="Search"
        />,
      );
    });

    const input = renderer!.root.findByType(TextInput);
    const findFocusBorders = () =>
      renderer!.root.findAll(
        (node) =>
          Array.isArray(node.props.style) &&
          node.props.style.some(
            (style: { borderColor?: string } | undefined) => style?.borderColor === 'accent',
          ) &&
          node.props.entering,
      );

    expect(findFocusBorders()).toHaveLength(0);
    act(() => void input.props.onFocus());
    expect(findFocusBorders()).toHaveLength(1);
    expect(findFocusBorders()[0].props.exiting).toBeUndefined();
  });
});
