import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { AppText } from '@/components/common/AppText';
import { InteractivePressable } from '@/components/common/InteractivePressable';
import { Toggle } from '@/components/common/Toggle';
import { DeleteForEveryoneRow } from '../DeleteForEveryoneRow';

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
  interpolate: () => 0,
  interpolateColor: () => undefined,
  useAnimatedStyle: (read: () => object) => read(),
  useSharedValue: (value: number) => ({ value }),
  withTiming: (value: number) => value,
}));

jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (select: (state: object) => unknown) => select({ accent: 'blue' }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, { name }: { name?: string } = {}) =>
      key === 'chat.message_delete.named_peer' ? `${name}側でも削除する` : key,
  }),
}));

it('makes the whole row the switch and bounds a long, emphasized name', () => {
  const name = 'VeryLongUnbrokenName'.repeat(20);
  const onValueChange = jest.fn();
  let renderer: ReactTestRenderer;
  act(() => {
    renderer = create(
      <DeleteForEveryoneRow
        group={false}
        peerName={name}
        value={false}
        disabled={false}
        onValueChange={onValueChange}
      />,
    );
  });

  const row = renderer!.root.findByType(InteractivePressable);
  expect(row.props).toMatchObject({
    accessibilityRole: 'switch',
    hoverFeedback: false,
    accessibilityLabel: `${name}側でも削除する`,
    accessibilityState: { checked: false, disabled: false },
  });
  expect(row.props.style.backgroundColor).toBeUndefined();
  const [label, boldName] = row.findAllByType(AppText);
  expect(label.props).toMatchObject({
    numberOfLines: 2,
    ellipsizeMode: 'tail',
    style: { flex: 1, minWidth: 0 },
  });
  expect(boldName.props).toMatchObject({ weight: 'bold', children: name });
  expect(row.findByType(Toggle).props.onValueChange).toBeUndefined();

  act(() => { row.props.onPress(); });
  expect(onValueChange).toHaveBeenCalledWith(true);
  act(() => renderer!.unmount());
});
