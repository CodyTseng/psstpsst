import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';

import { AppText } from '../AppText';
import { InteractivePressable } from '../InteractivePressable';
import { ListGroup } from '../ListGroup';
import { ListRow } from '../ListRow';
import { uiDensity } from '@/theme';

// The real store persists through the db (expo-sqlite), which jest-expo leaves
// without a native binding; ListRow only needs a static accent.
jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: { accent: 'blue' }) => unknown) =>
    selector({ accent: 'blue' }),
}));

jest.mock('@/lib/platform', () => ({
  ...jest.requireActual('@/lib/platform'),
  IS_ELECTRON: true,
}));

describe('ListRow layout', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  function renderRow(preserveColumn?: 'title' | 'value') {
    act(() => {
      renderer = create(
        <ListRow
          title="A very long open-source project name"
          value="Apache-2.0"
          preserveColumn={preserveColumn}
          trailing={<View testID="external-link" />}
        />,
      );
    });

    const textNodes = renderer!.root.findAllByType(AppText);
    return {
      titleContainer: textNodes[0].parent,
      value: textNodes[1],
      trailing: renderer!.root.findByProps({ testID: 'external-link' }),
    };
  }

  it('preserves the title column by default', () => {
    const { titleContainer, value } = renderRow();

    expect(titleContainer?.props.style).toMatchObject({ flexShrink: 0 });
    expect(value.props.style).toMatchObject({ flexShrink: 1 });
  });

  it('can preserve the value and trailing accessory instead', () => {
    const { titleContainer, value, trailing } = renderRow('value');

    expect(titleContainer?.props.style).toMatchObject({ flexShrink: 1, minWidth: 0 });
    expect(value.props.style).toMatchObject({ flexShrink: 0 });
    expect(trailing.parent?.props.style).toMatchObject({ flexShrink: 0 });
  });

  it.each([
    { name: 'subtitle', props: { subtitle: 'Supporting metadata' } },
    {
      name: 'below value',
      props: { value: 'npub1verylongidentifier', valuePlacement: 'below' as const },
    },
  ])('lets a $name text stack yield to its trailing accessory', ({ props }) => {
    act(() => {
      renderer = create(
        <ListRow
          title="Label"
          {...props}
          trailing={<View testID="trailing-accessory" />}
        />,
      );
    });

    const titleContainer = renderer!.root.findAllByType(AppText)[0].parent;
    const trailing = renderer!.root.findByProps({ testID: 'trailing-accessory' });

    expect(titleContainer?.props.style).toMatchObject({ flexShrink: 1, minWidth: 0 });
    expect(trailing.parent?.props.style).toMatchObject({ flexShrink: 0 });
  });

  it('allows a registered supporting description to wrap at dynamic height', () => {
    act(() => {
      renderer = create(
        <ListRow
          title="Import from Nostr"
          subtitle="Bring in people you follow in other Nostr apps."
          subtitleMultiline
          trailing={<View testID="trailing-accessory" />}
        />,
      );
    });

    const pressable = renderer!.root.findAllByType(View)[0];
    const subtitle = renderer!.root.findAllByType(AppText)[1];

    expect(StyleSheet.flatten(pressable.props.style)).toMatchObject({
      height: undefined,
      minHeight: uiDensity.listRowTwoLineHeight,
    });
    expect(subtitle.props.numberOfLines).toBeUndefined();
  });

  it('renders custom below-value content inside the shrinking text stack', () => {
    act(() => {
      renderer = create(
        <ListRow
          title="NIP-05"
          value="name@example.com"
          valuePlacement="below"
          belowValue={<View testID="verified-identifier" />}
          trailing={<View testID="copy-action" />}
        />,
      );
    });

    const customValue = renderer!.root.findByProps({ testID: 'verified-identifier' });
    const titleContainer = renderer!.root.findAllByType(AppText)[0].parent;

    expect(customValue).toBeTruthy();
    expect(titleContainer?.props.style).toMatchObject({ flexShrink: 1, minWidth: 0 });
  });

  it('keeps the end of a middle-ellipsized value visible on Electron', () => {
    const value = 'npub1abcdefghijklmnopqrstuvwxyz0123456789';

    act(() => {
      renderer = create(
        <ListRow
          title="Public key"
          value={value}
          valuePlacement="below"
          valueEllipsizeMode="middle"
        />,
      );
    });

    const textNodes = renderer!.root.findAllByType(AppText);
    const prefix = textNodes[1];
    const suffix = textNodes[2];

    expect(prefix.props.ellipsizeMode).toBe('tail');
    expect(prefix.props.children + suffix.props.children).toBe(value);
    expect(suffix.props.children).toBe(value.slice(-8));
  });

  it('reveals a reserved trailing accessory only while the row is hovered', () => {
    act(() => {
      renderer = create(
        <ListRow
          title="photo.jpg"
          subtitle="1.2 MB"
          trailingOnHover={<View testID="remove-file" />}
          variant="plain"
        />,
      );
    });

    const hidden = renderer!.root.findByProps({
      importantForAccessibility: 'no-hide-descendants',
    });
    expect(hidden.props.style).toMatchObject({ opacity: 0, pointerEvents: 'none' });

    const pointerSurface = renderer!.root.findAll(
      (node) => typeof node.props.onPointerEnter === 'function',
    )[0];
    act(() => {
      pointerSurface.props.onPointerEnter({ nativeEvent: { pointerType: 'mouse' } });
    });

    const visible = renderer!.root.findByProps({ importantForAccessibility: 'auto' });
    expect(visible.props.style).toMatchObject({ opacity: 1, pointerEvents: 'auto' });
  });

  it('keeps rows embedded inside one grouped surface', () => {
    act(() => {
      renderer = create(
        <ListGroup>
          <ListRow title="Wallet" onPress={jest.fn()} />
          <ListRow title="Chats" onPress={jest.fn()} />
        </ListGroup>,
      );
    });

    const rows = renderer!.root.findAllByType(InteractivePressable);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(StyleSheet.flatten(row.props.style)).toMatchObject({
        borderRadius: 0,
        borderWidth: 0,
        backgroundColor: 'transparent',
      });
    }
  });

  it('exposes checked radio semantics for a single-choice row', () => {
    act(() => {
      renderer = create(
        <ListRow
          title="Spam"
          active
          selectionMode="single"
          onPress={jest.fn()}
        />,
      );
    });

    const row = renderer!.root.findByType(InteractivePressable);
    expect(row.props.accessibilityRole).toBe('radio');
    expect(row.props.accessibilityState).toEqual({ checked: true });
  });
});
