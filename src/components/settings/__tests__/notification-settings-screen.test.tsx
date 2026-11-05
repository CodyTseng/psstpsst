import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import NotificationsSettings from '@/app/(app)/notifications';
import { ListRow } from '@/components/common/ListRow';
import { Toggle } from '@/components/common/Toggle';
import { notificationService } from '@/services/notifications/notification.service';

const mockContent = { showSender: true, showMessageContent: true };
const mockDnd = { enabled: true, startMinutes: 1320, endMinutes: 480 };
jest.mock('@solar-icons/react-native/category/notifications/Linear/Bell', () => ({ Bell: () => null }), { virtual: true });
jest.mock('@solar-icons/react-native/category/messages/Linear/ChatRoundUnread', () => ({ ChatRoundUnread: () => null }), { virtual: true });
jest.mock('@solar-icons/react-native/category/weather/Linear/MoonSleep', () => ({ MoonSleep: () => null }), { virtual: true });
jest.mock('@solar-icons/react-native/category/devices/Linear/ServerSquare', () => ({ ServerSquare: () => null }), { virtual: true });
jest.mock('@/components/common/DirectionalChevron', () => ({ DirectionalChevron: () => null }));
jest.mock('@/services/notifications/notification.service', () => ({ notificationService: {
  getCachedContentPreferences: () => mockContent,
  getCachedDndWindow: () => mockDnd,
  getContentPreferences: jest.fn(() => new Promise(() => {})),
  getDndWindow: jest.fn(() => new Promise(() => {})),
} }));
jest.mock('@/services/notifications/notification-prefs', () => ({ DEFAULT_DND_WINDOW: {}, DEFAULT_NOTIFICATION_CONTENT_PREFERENCES: {} }));
jest.mock('@/services/conversation/unread-count.service', () => ({ unreadCountService: {} }));
jest.mock('@/stores/unread-count.store', () => ({ useUnreadIndicatorPreference: () => ({ enabled: true, resolved: true }) }));
jest.mock('@/hooks/use-quiet-message-requests', () => ({ useQuietMessageRequests: () => ({ quiet: false, resolved: true }) }));
jest.mock('@/stores/date-time.store', () => ({ useDateTimePreferences: () => ({}) }));
jest.mock('@/hooks/use-notification-status', () => ({ useNotificationStatus: () => ({ enabled: true, busy: false }) }));
jest.mock('@/hooks/use-apns-relay-eligibility', () => ({ useApnsRelayEligibility: () => ({ resolved: true, eligible: true }) }));
jest.mock('@/hooks/use-scrolled', () => ({ useScrolled: () => ({ scrolled: false, scrollProps: {} }) }));
jest.mock('@/services/notifications/push-api', () => ({ APNS_RELAY_URL: '' }));
jest.mock('@/lib/platform', () => ({ IS_ELECTRON: true, DESKTOP_OS: 'darwin' }));
jest.mock('@/platform', () => ({ platform: {} }));
jest.mock('expo-router', () => ({ router: {} }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/theme', () => ({ spacing: { xs: 4, sm: 8, lg: 16 }, useThemeColors: () => ({}) }));
jest.mock('@/components/common/AppScreen', () => ({ AppScreen: ({ children }: { children: unknown }) => children }));
jest.mock('@/components/common/ListGroup', () => ({ ListGroup: ({ children }: { children: unknown }) => children }));
jest.mock('@/components/common/AppText', () => ({ AppText: () => null }));
jest.mock('@/components/common/ListRow', () => ({ ListRow: ({ trailing }: { trailing: unknown }) => trailing }));
jest.mock('@/components/common/Toggle', () => ({ Toggle: () => null }));
jest.mock('@/components/common/ScreenHeader', () => ({ ScreenHeader: () => null, useScreenHeaderClearance: () => 48 }));
jest.mock('@/components/common/TimeOfDayPicker', () => ({ TimeOfDayPicker: () => null, formatMinutes: (value: number) => String(value) }));

it('shows resolved controls on the first render of every visit while async refresh is still pending', () => {
  for (let visit = 0; visit < 2; visit += 1) {
    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(<NotificationsSettings />); });
    const rows = renderer.root.findAllByType(ListRow);
    expect(rows.every(row => !row.props.loading)).toBe(true);
    const toggles = renderer.root.findAllByType(Toggle);
    expect(toggles).toHaveLength(6);
    expect(toggles.filter(toggle => toggle.props.accessibilityLabel !== 'notifications.quiet_requests_label').every(toggle => toggle.props.value === true)).toBe(true);
    expect(rows.find(row => row.props.title === 'notifications.dnd_from')!.props.value).toBe('1320');
    act(() => renderer.unmount());
  }
  expect(notificationService.getContentPreferences).toHaveBeenCalledTimes(2);
});
