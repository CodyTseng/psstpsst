import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { IncomingMessageBanner } from '@/components/chat/IncomingMessageBanner';
import { IncomingMessageBannerHost } from '../incoming-message-banner-host';

let mockIndicatorsEnabled = false;
let mockRequests = { resolved: true, quiet: false };

jest.mock('expo-router', () => ({
  Navigator: { useContext: () => ({ state: { routes: [{ name: '(tabs)' }] } }) },
  router: {},
}));
jest.mock('@/components/chat/IncomingMessageBanner', () => ({ IncomingMessageBanner: () => null }));
jest.mock('@/components/navigation/responsive-stack-router', () => ({ PRIMARY_PANE_RESET_MARKER: 'primary' }));
jest.mock('@/hooks/use-quiet-message-requests', () => ({ useQuietMessageRequests: () => mockRequests }));
jest.mock('@/stores/active-account.store', () => ({ useActiveAccount: () => 'self' }));
jest.mock('@/stores/unread-count.store', () => ({ useUnreadIndicatorPreference: () => ({ enabled: mockIndicatorsEnabled, resolved: true }) }));

it.each([
  { indicators: false, quiet: false, resolved: true, enabled: false },
  { indicators: false, quiet: true, resolved: true, enabled: false },
  { indicators: true, quiet: true, resolved: true, enabled: true },
  { indicators: false, quiet: false, resolved: false, enabled: false },
])('gates all arrival banners with the global indicator preference: %j', (settings) => {
  mockIndicatorsEnabled = settings.indicators;
  mockRequests = { quiet: settings.quiet, resolved: settings.resolved };
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(<IncomingMessageBannerHost wide />); });
  const banner = renderer.root.findByType(IncomingMessageBanner);
  expect(banner.props.enabled).toBe(settings.enabled);
  expect(banner.props.quietRequests).toBe(!settings.resolved || settings.quiet);
  expect(banner.props.chatsVisible).toBe(true);
  act(() => renderer.unmount());
});
