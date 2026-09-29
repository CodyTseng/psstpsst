import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ScrollView, StyleSheet } from 'react-native';

import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import { Avatar } from '@/components/common/Avatar';
import { EdgeFade } from '@/components/common/EdgeFade';
import type { DeliveryCopy } from '@/stores/delivery-status.store';
import { spacing, uiDensity } from '@/theme';

import {
  DeliveryCopyDetail,
  DeliveryCopyTab,
  DeliveryCopyTabs,
  DeliverySummaryRow,
  orderDeliveryCopies,
} from '../MessageDetailSheet';

jest.mock('lucide-react-native/icons/chevron-down', () => ({
  __esModule: true,
  default: () => null,
}), { virtual: true });
jest.mock('lucide-react-native/icons/chevron-up', () => ({
  __esModule: true,
  default: () => null,
}), { virtual: true });
jest.mock('lucide-react-native/icons/check', () => ({
  __esModule: true,
  default: () => null,
}), { virtual: true });
jest.mock('@solar-icons/react-native/category/ui/Linear/Copy', () => ({
  Copy: () => null,
}), { virtual: true });
jest.mock('@solar-icons/react-native/category/ui/Linear/DangerCircle', () => ({
  DangerCircle: () => null,
}), { virtual: true });
jest.mock('@solar-icons/react-native/category/time/Linear/ClockCircle', () => ({
  ClockCircle: () => null,
}), { virtual: true });
jest.mock('@solar-icons/react-native/category/devices/Linear/ServerSquare', () => ({
  ServerSquare: () => null,
}), { virtual: true });
jest.mock('@solar-icons/react-native/category/messages/Linear/Pen2', () => ({
  Pen2: () => null,
}), { virtual: true });
jest.mock('@/components/common/Avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/common/BottomSheet', () => ({ BottomSheet: () => null }));
jest.mock('@/components/common/EdgeFade', () => ({ EdgeFade: () => null }));
jest.mock('@/hooks/use-message-deliveries', () => ({
  useMessageDelivery: () => null,
}));
jest.mock('@/lib/time', () => ({ formatDetailTimestamp: () => '' }));
jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: {
    accent: 'blue';
    preference: 'dark';
  }) => unknown) => selector({ accent: 'blue', preference: 'dark' }),
}));
jest.mock('@/hooks/use-profile', () => ({ useProfile: () => null }));
jest.mock('@/hooks/use-contacts', () => ({ useContact: () => null }));
jest.mock('@/i18n/direction', () => ({
  useLanguageDirection: () => 'ltr',
  getLanguageDirection: () => 'ltr',
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}));

describe('DeliveryCopyDetail', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('expands a failed relay reason without putting retry in the target detail', () => {
    const copy: DeliveryCopy = {
      recipient: 'recipient-pubkey',
      self: false,
      relays: [
        {
          url: 'wss://relay.example',
          status: 'failed',
          error: 'connection refused',
        },
      ],
    };

    act(() => {
      renderer = create(
        <DeliveryCopyDetail
          accountPubkey="account-pubkey"
          copy={copy}
        />,
      );
    });

    const hasReason = () =>
      renderer!.root
        .findAllByType(AppText)
        .some((node) => node.props.children === 'connection refused');
    expect(hasReason()).toBe(false);

    const relayRow = renderer!.root.findAllByProps({
      accessibilityLabel: 'relay.example',
    })[0];
    act(() => {
      void relayRow.props.onPress();
    });
    expect(hasReason()).toBe(true);

    const resend = renderer!.root
      .findAllByType(AppButton)
      .find((button) => button.props.label === 'delivery.resend');
    expect(resend).toBeUndefined();
  });
});

describe('DeliverySummaryRow', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('keeps one height while the retry-all action appears and disappears', () => {
    const onRetry = jest.fn();
    act(() => {
      renderer = create(
        <DeliverySummaryRow label="Delivered" onRetry={onRetry} />,
      );
    });

    const summaryHeight = () => {
      const row = renderer!.root.findAll((node) =>
        StyleSheet.flatten(node.props.style)?.minHeight != null
      )[0];
      return StyleSheet.flatten(row.props.style).minHeight;
    };
    const heightWithRetry = summaryHeight();
    const retry = renderer!.root
      .findAllByType(AppButton)
      .find((button) => button.props.label === 'delivery.resend');
    expect(retry).toBeDefined();
    act(() => {
      void retry!.props.onPress();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);

    act(() => {
      renderer!.update(<DeliverySummaryRow label="Delivered" />);
    });
    expect(summaryHeight()).toBe(heightWithRetry);
    expect(
      renderer!.root
        .findAllByType(AppButton)
        .some((button) => button.props.label === 'delivery.resend'),
    ).toBe(false);
  });
});

describe('DeliveryCopyTab', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('stretches the avatar button across the fixed tab so its content is centered', () => {
    const copy: DeliveryCopy = {
      recipient: 'recipient-pubkey',
      self: false,
      relays: [{ url: 'wss://relay.example', status: 'ok' }],
    };

    act(() => {
      renderer = create(
        <DeliveryCopyTab
          accountPubkey="account-pubkey"
          copy={copy}
          selected
          onSelect={jest.fn()}
        />,
      );
    });

    const tabButton = renderer!.root
      .findAllByType(AppButton)
      .find((button) => button.props.accessibilityRole === 'tab');
    expect(tabButton?.props.fullWidth).toBe(true);
    expect(tabButton?.props.compact).toBe(true);
    expect(tabButton?.props.compactInset).toBe(spacing.sm);
    expect(tabButton?.props.compactAxis).toBeUndefined();
    expect(tabButton?.props.corner).toBe('lg');
    expect(tabButton?.props.selected).toBe(true);
    expect(renderer!.root.findByType(Avatar).props.size).toBe(
      uiDensity.contactAvatarSize,
    );
    const statusBadge = renderer!.root.findAll((node) => {
      const style = StyleSheet.flatten(node.props.style);
      return style?.position === 'absolute' &&
        style.pointerEvents === 'none' &&
        style.width === uiDensity.countBadge.sm.size;
    })[0];
    const statusStyle = StyleSheet.flatten(statusBadge.props.style);
    expect(statusStyle.end).toBe(statusStyle.bottom);
    expect(statusStyle.end).toBe(uiDensity.messageDeliveryStatusInset);
  });

  it('uses the dedicated self label for the account copy', () => {
    const copy: DeliveryCopy = {
      recipient: 'account-pubkey',
      self: true,
      relays: [{ url: 'wss://relay.example', status: 'ok' }],
    };

    act(() => {
      renderer = create(
        <DeliveryCopyTab
          accountPubkey="account-pubkey"
          copy={copy}
          selected={false}
          onSelect={jest.fn()}
        />,
      );
    });

    const tabButton = renderer!.root
      .findAllByType(AppButton)
      .find((button) => button.props.accessibilityRole === 'tab');
    expect(tabButton?.props.accessibilityLabel).toBe('delivery.self');
  });
});

describe('DeliveryCopyTabs', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('shows logical-edge fades only while tabs remain offscreen there', () => {
    const copies: DeliveryCopy[] = [
      { recipient: 'first', self: false, relays: [] },
      { recipient: 'second', self: false, relays: [] },
      { recipient: 'third', self: false, relays: [] },
    ];
    act(() => {
      renderer = create(
        <DeliveryCopyTabs
          accountPubkey="account-pubkey"
          copies={copies}
          selectedRecipient="first"
          onSelect={jest.fn()}
        />,
      );
    });

    let scroll = renderer!.root.findByType(ScrollView);
    expect(
      StyleSheet.flatten(scroll.props.contentContainerStyle).paddingHorizontal,
    ).toBe(spacing.lg);
    expect(renderer!.root.findAll((node) =>
      StyleSheet.flatten(node.props.style)?.marginHorizontal === -spacing.lg
    )).not.toHaveLength(0);
    act(() => {
      scroll.props.onLayout({ nativeEvent: { layout: { width: 100 } } });
      scroll.props.onContentSizeChange(200, 56);
    });
    expect(
      renderer!.root.findAllByType(EdgeFade).map((fade) => fade.props.edge),
    ).toEqual(['end']);

    scroll = renderer!.root.findByType(ScrollView);
    act(() => {
      scroll.props.onScroll({
        nativeEvent: {
          contentOffset: { x: 50 },
          layoutMeasurement: { width: 100 },
          contentSize: { width: 200 },
        },
      });
    });
    expect(
      renderer!.root.findAllByType(EdgeFade).map((fade) => fade.props.edge),
    ).toEqual(['start', 'end']);

    scroll = renderer!.root.findByType(ScrollView);
    act(() => {
      scroll.props.onScroll({
        nativeEvent: {
          contentOffset: { x: 100 },
          layoutMeasurement: { width: 100 },
          contentSize: { width: 200 },
        },
      });
    });
    expect(
      renderer!.root.findAllByType(EdgeFade).map((fade) => fade.props.edge),
    ).toEqual(['start']);
  });

  it('renders the account copy after every recipient tab', () => {
    const accountCopy: DeliveryCopy = {
      recipient: 'account-pubkey',
      self: false,
      relays: [],
    };
    const recipient: DeliveryCopy = {
      recipient: 'recipient-pubkey',
      self: false,
      relays: [],
    };
    act(() => {
      renderer = create(
        <DeliveryCopyTabs
          accountPubkey="account-pubkey"
          copies={[accountCopy, recipient]}
          selectedRecipient="recipient-pubkey"
          onSelect={jest.fn()}
        />,
      );
    });

    expect(
      renderer!.root.findAllByType(DeliveryCopyTab).map((tab) => tab.props.copy.recipient),
    ).toEqual(['recipient-pubkey', 'account-pubkey']);
  });
});

describe('orderDeliveryCopies', () => {
  it('keeps recipient order stable and moves the self copy last', () => {
    const self: DeliveryCopy = { recipient: 'self', self: true, relays: [] };
    const first: DeliveryCopy = { recipient: 'first', self: false, relays: [] };
    const second: DeliveryCopy = { recipient: 'second', self: false, relays: [] };

    expect(orderDeliveryCopies([self, first, second], 'self')).toEqual([
      first,
      second,
      self,
    ]);
  });

  it('uses recipient identity even when a stale self flag is wrong', () => {
    const accountCopy: DeliveryCopy = {
      recipient: 'account-pubkey',
      self: false,
      relays: [],
    };
    const recipient: DeliveryCopy = {
      recipient: 'recipient-pubkey',
      self: true,
      relays: [],
    };

    expect(
      orderDeliveryCopies([accountCopy, recipient], 'account-pubkey'),
    ).toEqual([recipient, accountCopy]);
  });
});
