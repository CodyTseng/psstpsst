import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';

import { RadioIndicator } from '../radio-indicator';

jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: { accent: 'blue' }) => unknown) =>
    selector({ accent: 'blue' }),
}));

describe('RadioIndicator', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('renders an empty ring when unselected', () => {
    act(() => {
      renderer = create(<RadioIndicator selected={false} />);
    });

    const views = renderer!.root.findAllByType(View);
    expect(views).toHaveLength(1);
    expect(StyleSheet.flatten(views[0].props.style)).toMatchObject({
      width: 22,
      height: 22,
      borderWidth: 2,
    });
  });

  it('renders a centred dot when selected', () => {
    act(() => {
      renderer = create(<RadioIndicator selected />);
    });

    const views = renderer!.root.findAllByType(View);
    expect(views).toHaveLength(2);
    expect(StyleSheet.flatten(views[1].props.style)).toMatchObject({
      width: 10,
      height: 10,
    });
  });
});
