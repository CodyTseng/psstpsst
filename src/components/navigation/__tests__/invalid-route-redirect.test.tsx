import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { router } from 'expo-router';

import { InvalidRouteRedirect } from '../InvalidRouteRedirect';

jest.mock('expo-router', () => ({
  router: {
    canDismiss: jest.fn(),
    dismissAll: jest.fn(),
    replace: jest.fn(),
  },
}));
jest.mock('@/components/common/AppScreen', () => ({ AppScreen: () => null }));

describe('InvalidRouteRedirect', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.mocked(router.canDismiss).mockReturnValue(true);
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('leaves malformed routes after render without navigating during render', () => {
    act(() => {
      renderer = create(<InvalidRouteRedirect />);
    });

    expect(router.replace).not.toHaveBeenCalled();

    act(() => jest.runOnlyPendingTimers());

    expect(router.dismissAll).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/');
  });
});
