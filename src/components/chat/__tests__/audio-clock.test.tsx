import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';

import { AudioClock } from '../audio-clock';

jest.mock('@/components/common/AppText', () => ({
  AppText: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require('react') as typeof import('react');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const NativeText = (require('react-native') as typeof import('react-native')).Text;
    return React.createElement(NativeText, props);
  },
}));

describe('AudioClock', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('uses monospaced tabular text with fixed player digits', () => {
    act(() => {
      renderer = create(
        <AudioClock seconds={7} totalSeconds={720} color="test-color" />,
      );
    });

    const text = renderer!.root.findByType(Text);
    expect(text.props.variant).toBe('code');
    expect(text.props.style).toMatchObject({
      color: 'test-color',
      fontVariant: ['tabular-nums'],
    });
    expect(text.props.children).toBe('00:07');
  });
});
