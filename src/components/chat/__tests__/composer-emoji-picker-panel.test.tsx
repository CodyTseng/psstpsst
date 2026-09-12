import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ComposerEmojiPickerPanel } from '../ComposerEmojiPickerPanel';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/theme', () => ({
  shadow: { float: {} },
  spacing: { xl: 20 },
}));

jest.mock('@/components/common/SegmentedControl', () => ({
  SegmentedControl: ({
    onChange,
  }: {
    onChange: (value: 'unicode' | 'custom') => void;
  }) => {
    const React = jest.requireActual('react') as typeof import('react');
    const { Pressable } = jest.requireActual('react-native') as typeof import('react-native');
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(Pressable, {
        accessibilityLabel: 'show-unicode',
        onPress: () => onChange('unicode'),
      }),
      React.createElement(Pressable, {
        accessibilityLabel: 'show-custom',
        onPress: () => onChange('custom'),
      }),
    );
  },
}));

jest.mock('../EmojiPickerPanel', () => ({
  EmojiPickerPanel: () => {
    const React = jest.requireActual('react') as typeof import('react');
    const { Text } = jest.requireActual('react-native') as typeof import('react-native');
    return React.createElement(Text, null, 'custom-panel');
  },
}));

jest.mock('../UnicodeEmojiPickerPanel', () => ({
  UnicodeEmojiPickerPanel: () => {
    const React = jest.requireActual('react') as typeof import('react');
    const { Text } = jest.requireActual('react-native') as typeof import('react-native');
    return React.createElement(Text, null, 'unicode-panel');
  },
}));

describe('ComposerEmojiPickerPanel', () => {
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = null;
  });

  it('opens on stickers by default', () => {
    const props = {
      active: true,
      customPacks: [],
      onSelect: jest.fn(),
      safeBottom: 0,
      standaloneCustomEmojis: [],
      width: 390,
    };

    act(() => {
      renderer = create(<ComposerEmojiPickerPanel {...props} />);
    });
    expect(JSON.stringify(renderer!.toJSON())).toContain('custom-panel');
  });
});
