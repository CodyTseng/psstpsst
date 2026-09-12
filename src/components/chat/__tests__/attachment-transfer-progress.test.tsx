import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { View } from 'react-native';
import { Circle } from 'react-native-svg';

import {
  attachmentTransferKey,
  attachmentTransferStore,
} from '@/services/files/attachment-transfer-state';

import { AttachmentTransferProgress } from '../AttachmentTransferProgress';

jest.mock(
  'lucide-react-native/icons/pause',
  () => ({
    __esModule: true,
    default: () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const React = require('react') as typeof import('react');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const NativeView = (require('react-native') as typeof import('react-native')).View;
      return React.createElement(NativeView, { testID: 'pause-action' });
    },
  }),
  { virtual: true },
);

jest.mock('@/stores/active-account.store', () => ({
  useActiveAccount: (selector: (state: { activePubkey: string }) => unknown) =>
    selector({ activePubkey: 'account' }),
}));

jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: { accent: 'blue'; preference: 'light' }) => unknown) =>
    selector({ accent: 'blue', preference: 'light' }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('AttachmentTransferProgress', () => {
  const key = attachmentTransferKey('account', 'rumor');
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    attachmentTransferStore.getState().clear(key);
    renderer = undefined;
  });

  it('centres pause inside a circular Bluetooth progress ring', () => {
    attachmentTransferStore.getState().update(key, 'bluetooth', 50, 100);
    act(() => {
      renderer = create(<AttachmentTransferProgress messageId="rumor" size="media" />);
    });

    const root = renderer!.root
      .findAllByType(View)
      .find((node) => node.props.accessibilityRole === 'progressbar')!;
    expect(root.props.style).toMatchObject({ alignItems: 'center', justifyContent: 'center' });
    expect(renderer!.root.findAllByType(Circle)).toHaveLength(2);
    const progressCircle = renderer!.root.findAllByType(Circle)[1];
    expect(progressCircle.props.transform).toBe('rotate(-90 28 28)');
    expect(progressCircle.props.origin).toBeUndefined();
    expect(
      renderer!.root.findAllByType(View).filter((node) => node.props.testID === 'pause-action'),
    ).toHaveLength(1);
    expect(root.props.accessibilityLabel).toBe('common.pause, attach.transfer_bluetooth');
    expect(root.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 50 });
  });

  it('centres pause inside a circular network progress ring', () => {
    attachmentTransferStore.getState().update(key, 'network', 25, 100);
    act(() => {
      renderer = create(<AttachmentTransferProgress messageId="rumor" />);
    });

    expect(renderer!.root.findAllByType(Circle)).toHaveLength(2);
    expect(
      renderer!.root.findAllByType(View).filter((node) => node.props.testID === 'pause-action'),
    ).toHaveLength(1);
  });

  it('renders preparation as a centred ring before byte progress exists', () => {
    act(() => {
      renderer = create(
        <AttachmentTransferProgress messageId="rumor" fallbackPercent={5} />,
      );
    });

    const root = renderer!.root
      .findAllByType(View)
      .find((node) => node.props.accessibilityRole === 'progressbar')!;
    expect(root.props.style).toMatchObject({ alignItems: 'center', justifyContent: 'center' });
    expect(root.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 5 });
    expect(renderer!.root.findAllByType(Circle)).toHaveLength(2);
  });

  it('completes the publishing ring without a stale pause action', () => {
    act(() => {
      renderer = create(
        <AttachmentTransferProgress
          messageId="rumor"
          fallbackPercent={100}
          showPause={false}
        />,
      );
    });

    expect(
      renderer!.root.findAllByType(View).filter((node) => node.props.testID === 'pause-action'),
    ).toHaveLength(0);
  });
});
