import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { InteractivePressable } from '@/components/common/InteractivePressable';
import { darkPalette, spacing } from '@/theme';

import { GroupSystemMessage } from '../GroupSystemMessage';
import { MESSAGE_DELIVERY_ICON_SIZE } from '../MessageDeliveryStatus';

jest.mock('@/hooks/use-profile', () => ({ useProfile: () => null }));
jest.mock('@/hooks/use-contacts', () => ({ useContact: () => null }));
jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: {
    accent: 'blue';
    preference: 'dark';
  }) => unknown) => selector({ accent: 'blue', preference: 'dark' }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('../MessageDeliveryStatus', () => ({
  MESSAGE_DELIVERY_ICON_SIZE: 11,
  MessageDeliveryStatus: () => null,
}));

describe('GroupSystemMessage', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('opens message detail for an action authored by another member', () => {
    const onShowDetail = jest.fn();
    act(() => {
      renderer = create(
        <GroupSystemMessage
          accountPubkey={'a'.repeat(64)}
          senderPubkey={'b'.repeat(64)}
          tags={[['action', 'invite', 'c'.repeat(64)]]}
          delivery={null}
          onShowDetail={onShowDetail}
        />,
      );
    });

    const button = renderer!.root.findByType(InteractivePressable);
    act(() => {
      void button.props.onPress();
    });
    expect(onShowDetail).toHaveBeenCalledTimes(1);
  });

  it('renders the action as plain muted text', () => {
    act(() => {
      renderer = create(
        <GroupSystemMessage
          accountPubkey={'a'.repeat(64)}
          senderPubkey={'b'.repeat(64)}
          tags={[['action', 'rename'], ['subject', 'New name']]}
          delivery={null}
        />,
      );
    });

    const label = renderer!.root.findByType(AppText);
    expect(label.props.variant).toBe('caption');
    expect(label.props.numberOfLines).toBe(1);
    expect(label.props.style.color).toBe(darkPalette.textMuted);

    const pressable = renderer!.root.findByType(InteractivePressable);
    const hoveredContent = pressable.props.children({ pressed: false, hovered: true });
    expect(hoveredContent.props.children[0].props.style.color).toBe(darkPalette.text);
  });

  it('uses the compact message icon size for own delivery state', () => {
    const accountPubkey = 'a'.repeat(64);
    act(() => {
      renderer = create(
        <GroupSystemMessage
          accountPubkey={accountPubkey}
          senderPubkey={accountPubkey}
          tags={[['action', 'rename'], ['subject', 'New name']]}
          delivery={{ rumorId: 'message', phase: 'sent', copies: [] }}
        />,
      );
    });

    const status = renderer!.root.findByType(
      jest.requireMock('../MessageDeliveryStatus').MessageDeliveryStatus,
    );
    expect(status.props.size).toBe(MESSAGE_DELIVERY_ICON_SIZE);
    expect(status.parent?.props.style.gap).toBe(spacing.xs);
  });

  it('keeps long action text away from the page boundary', () => {
    act(() => {
      renderer = create(
        <GroupSystemMessage
          accountPubkey={'a'.repeat(64)}
          senderPubkey={'b'.repeat(64)}
          tags={[['action', 'rename'], ['subject', 'A'.repeat(80)]]}
          delivery={null}
        />,
      );
    });

    expect(renderer!.root.findByType(View).props.style).toMatchObject({
      paddingHorizontal: spacing.lg,
    });
  });
});
