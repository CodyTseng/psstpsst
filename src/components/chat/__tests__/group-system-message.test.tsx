import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { View } from 'react-native';

import { AppButton } from '@/components/common/AppButton';
import { spacing, uiDensity } from '@/theme';

import { GroupSystemMessage } from '../GroupSystemMessage';

jest.mock('lucide-react-native/icons/log-out', () => ({
  __esModule: true,
  default: function LogOut() { return null; },
}), { virtual: true });
jest.mock('lucide-react-native/icons/pencil', () => ({
  __esModule: true,
  default: function Pencil() { return null; },
}), { virtual: true });
jest.mock('lucide-react-native/icons/user-minus', () => ({
  __esModule: true,
  default: function UserMinus() { return null; },
}), { virtual: true });
jest.mock('lucide-react-native/icons/user-plus', () => ({
  __esModule: true,
  default: function UserPlus() { return null; },
}), { virtual: true });
jest.mock('@/components/common/AppButton', () => ({ AppButton: () => null }));
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
jest.mock('../MessageDeliveryStatus', () => ({ MessageDeliveryStatus: () => null }));

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

    const button = renderer!.root.findByType(AppButton);
    act(() => {
      void button.props.onPress();
    });
    expect(onShowDetail).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      expected: 'UserPlus',
      sender: 'b',
      tags: [['action', 'invite', 'c'.repeat(64)]],
    },
    {
      expected: 'LogOut',
      sender: 'b',
      tags: [['action', 'remove', 'b'.repeat(64)]],
    },
    {
      expected: 'UserMinus',
      sender: 'b',
      tags: [['action', 'remove', 'c'.repeat(64)]],
    },
    {
      expected: 'Pencil',
      sender: 'b',
      tags: [['action', 'rename'], ['subject', 'New name']],
    },
  ])('uses the $expected icon for its action', ({ expected, sender, tags }) => {
    act(() => {
      renderer = create(
        <GroupSystemMessage
          accountPubkey={'a'.repeat(64)}
          senderPubkey={sender.repeat(64)}
          tags={tags}
          delivery={null}
        />,
      );
    });

    expect(renderer!.root.findByType(AppButton).props.iconLeft.type.name).toBe(expected);
  });

  it('uses one icon size for the action and delivery status slots', () => {
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

    const button = renderer!.root.findByType(AppButton);
    expect(button.props.iconLeft.props.size).toBe(uiDensity.conversationStatusIconSize);
    expect(button.props.iconRight.props.size).toBe(uiDensity.conversationStatusIconSize);
  });

  it('keeps long action capsules away from the page boundary', () => {
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
