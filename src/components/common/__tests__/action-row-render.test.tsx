import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ActionRow } from '../ActionRow';
import { AppButton } from '../AppButton';

// The real store persists through the db (expo-sqlite), which jest-expo leaves
// without a native binding; ActionRow only needs a static accent.
jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: { accent: 'blue' }) => unknown) =>
    selector({ accent: 'blue' }),
}));

describe('ActionRow layout', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('stretches a lone confirm action across the row', () => {
    act(() => {
      renderer = create(
        <ActionRow layout="horizontal" confirm={{ label: 'Save', onPress: jest.fn() }} />,
      );
    });

    const confirmButton = renderer!.root.findByType(AppButton);
    expect(confirmButton.parent?.props.style).toEqual({ flex: 1 });
  });

  it('places the horizontal confirm action at logical inline-end', () => {
    act(() => {
      renderer = create(
        <ActionRow
          layout="horizontal"
          dismiss={{ label: 'Cancel', onPress: jest.fn() }}
          confirm={{ label: 'Send', onPress: jest.fn() }}
        />,
      );
    });

    expect(renderer!.toJSON()).toMatchObject({ props: { style: { flexDirection: 'row' } } });
    expect(renderer!.root.findAllByType(AppButton).map((button) => button.props.label)).toEqual([
      'Cancel',
      'Send',
    ]);
  });

  it('places the vertical confirm action above the dismiss action', () => {
    act(() => {
      renderer = create(
        <ActionRow
          layout="vertical"
          dismiss={{ label: 'Cancel', onPress: jest.fn() }}
          confirm={{ label: 'Delete', onPress: jest.fn(), destructive: true }}
        />,
      );
    });

    expect(renderer!.toJSON()).toMatchObject({ props: { style: { flexDirection: 'column' } } });
    expect(renderer!.root.findAllByType(AppButton).map((button) => button.props.label)).toEqual([
      'Delete',
      'Cancel',
    ]);
  });
});
