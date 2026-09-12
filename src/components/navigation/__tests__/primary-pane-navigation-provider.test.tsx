import React, { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { router, useGlobalSearchParams, usePathname } from 'expo-router';
import { useWindowDimensions } from 'react-native';

import {
  PrimaryPaneNavigationProvider,
  usePrimaryPaneNavigation,
} from '../primary-pane-navigation';
import { PRIMARY_PANE_RESET_MARKER } from '../responsive-stack-router';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useGlobalSearchParams: jest.fn(),
  usePathname: jest.fn(),
}));

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  const windowDimensions = jest.fn();
  return new Proxy(actual, {
    get(target, property, receiver) {
      if (property === 'useWindowDimensions') return windowDimensions;
      return Reflect.get(target, property, receiver);
    },
  });
});

const mockUseGlobalSearchParams = useGlobalSearchParams as jest.Mock;
const mockUsePathname = usePathname as jest.Mock;
const mockUseWindowDimensions = useWindowDimensions as jest.Mock;
const mockRouterPush = router.push as jest.Mock;

type NavigationValue = ReturnType<typeof usePrimaryPaneNavigation>;

function Probe({ onValue }: { onValue: (value: NavigationValue) => void }) {
  const value = usePrimaryPaneNavigation();
  useEffect(() => onValue(value), [onValue, value]);
  return null;
}

describe('PrimaryPaneNavigationProvider', () => {
  beforeEach(() => {
    mockUseGlobalSearchParams.mockReset();
    mockUsePathname.mockReset();
    mockUseWindowDimensions.mockReset();
    mockRouterPush.mockReset();
    mockUseGlobalSearchParams.mockReturnValue({});
    mockUsePathname.mockReturnValue('/');
  });

  it('does not subscribe compact tabs to global URL updates and keeps its context stable', () => {
    mockUseWindowDimensions.mockReturnValue({ width: 390, height: 844 });
    const onValue = jest.fn<void, [NavigationValue]>();
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(
        <PrimaryPaneNavigationProvider>
          <Probe onValue={onValue} />
        </PrimaryPaneNavigationProvider>,
      );
    });
    const first = onValue.mock.calls.at(-1)?.[0];

    act(() => {
      renderer.update(
        <PrimaryPaneNavigationProvider>
          <Probe onValue={onValue} />
        </PrimaryPaneNavigationProvider>,
      );
    });
    const last = onValue.mock.calls.at(-1)?.[0];

    expect(mockUsePathname).not.toHaveBeenCalled();
    expect(mockUseGlobalSearchParams).not.toHaveBeenCalled();
    expect(last).toBe(first);
    expect(last?.wide).toBe(false);
    expect(last?.selection.conversationKey).toBeNull();

    act(() => renderer.unmount());
  });

  it('subscribes in wide mode and derives the persistent conversation selection', () => {
    mockUseWindowDimensions.mockReturnValue({ width: 1024, height: 768 });
    mockUsePathname.mockReturnValue(`/chat/${'a'.repeat(64)}`);
    const onValue = jest.fn<void, [NavigationValue]>();
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(
        <PrimaryPaneNavigationProvider>
          <Probe onValue={onValue} />
        </PrimaryPaneNavigationProvider>,
      );
    });
    const value = onValue.mock.calls.at(-1)?.[0];
    const firstOpen = value?.open;

    mockUsePathname.mockReturnValue(`/chat/${'b'.repeat(64)}`);
    act(() => {
      renderer.update(
        <PrimaryPaneNavigationProvider>
          <Probe onValue={onValue} />
        </PrimaryPaneNavigationProvider>,
      );
    });
    const updatedValue = onValue.mock.calls.at(-1)?.[0];

    expect(mockUsePathname).toHaveBeenCalled();
    expect(mockUseGlobalSearchParams).toHaveBeenCalled();
    expect(updatedValue?.wide).toBe(true);
    expect(updatedValue?.selection.conversationKey).toBe('b'.repeat(64));
    expect(updatedValue?.open).toBe(firstOpen);

    act(() => renderer.unmount());
  });

  it('forwards repeated pathnames so the router can compare complete route identity', () => {
    mockUseWindowDimensions.mockReturnValue({ width: 1024, height: 768 });
    mockUsePathname.mockReturnValue('/chat/alice');
    const onValue = jest.fn<void, [NavigationValue]>();
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = create(
        <PrimaryPaneNavigationProvider>
          <Probe onValue={onValue} />
        </PrimaryPaneNavigationProvider>,
      );
    });
    const value = onValue.mock.calls.at(-1)?.[0];

    act(() => {
      value?.open('/chat/alice?focus=first');
      value?.open('/chat/alice?focus=second');
    });
    expect(mockRouterPush).toHaveBeenNthCalledWith(1, '/chat/alice?focus=first', {
      dangerouslySingular: PRIMARY_PANE_RESET_MARKER,
    });
    expect(mockRouterPush).toHaveBeenNthCalledWith(2, '/chat/alice?focus=second', {
      dangerouslySingular: PRIMARY_PANE_RESET_MARKER,
    });

    act(() => renderer.unmount());
  });
});
