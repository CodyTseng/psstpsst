import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import Svg from 'react-native-svg';

import { EdgeFade } from '../EdgeFade';

let mockIsRTL = false;

jest.mock('@/i18n/direction', () => ({
  useIsRTL: () => mockIsRTL,
}));

describe('EdgeFade logical positioning', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    mockIsRTL = false;
  });

  it.each([
    { isRTL: false, edge: 'start' as const, left: 0, right: undefined },
    { isRTL: false, edge: 'end' as const, left: undefined, right: 0 },
    { isRTL: true, edge: 'start' as const, left: undefined, right: 0 },
    { isRTL: true, edge: 'end' as const, left: 0, right: undefined },
  ])('pins $edge to the resolved physical edge when RTL is $isRTL', (expected) => {
    mockIsRTL = expected.isRTL;
    act(() => {
      renderer = create(<EdgeFade edge={expected.edge} color="#000" width={48} />);
    });

    const style = StyleSheet.flatten(renderer!.root.findByType(Svg).props.style);
    expect(style.left).toBe(expected.left);
    expect(style.right).toBe(expected.right);
    expect(style).not.toHaveProperty('start');
    expect(style).not.toHaveProperty('end');
  });
});
