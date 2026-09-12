import {
  getPrimaryPaneBaseState,
  isDuplicateActivePush,
  isPrimaryPaneResetAction,
  PRIMARY_PANE_RESET_MARKER,
  PRIMARY_ROUTE_NAME,
  responsiveStackRouter,
  shouldKeepDetailFocused,
} from '../responsive-stack-router';

describe('responsive stack router', () => {
  const state = {
    index: 1,
    routes: [
      { key: 'tabs', name: '(tabs)' },
      { key: 'chat', name: 'chat/[pubkey]' },
    ],
  };

  it('keeps the current detail when the persistent primary route receives child focus', () => {
    expect(shouldKeepDetailFocused(state, 'tabs')).toBe(true);
  });

  it('allows ordinary detail focus changes', () => {
    expect(shouldKeepDetailFocused(state, 'chat')).toBe(false);
  });

  it('does not intercept primary focus when the primary route is already active', () => {
    expect(shouldKeepDetailFocused({ ...state, index: 0 }, 'tabs')).toBe(false);
  });

  it('recognizes only marked pushes as atomic primary-pane resets', () => {
    expect(
      isPrimaryPaneResetAction({
        type: 'PUSH',
        payload: { name: 'appearance', singular: PRIMARY_PANE_RESET_MARKER },
      }),
    ).toBe(true);
    expect(
      isPrimaryPaneResetAction({
        type: 'PUSH',
        payload: { name: 'appearance', singular: () => 'primary-pane-detail' },
      }),
    ).toBe(false);
    expect(isPrimaryPaneResetAction({ type: 'REPLACE', payload: {} })).toBe(false);
  });

  it('recognizes a push to the exact active route as a no-op', () => {
    const activeState = {
      index: 1,
      routes: [
        { key: 'tabs', name: '(tabs)' },
        { key: 'alice', name: 'chat/[key]', params: { key: 'alice' } },
      ],
    };

    expect(
      isDuplicateActivePush(activeState, {
        type: 'PUSH',
        payload: { name: 'chat/[key]', params: { key: 'alice' } },
      }),
    ).toBe(true);
    expect(
      isDuplicateActivePush(activeState, {
        type: 'PUSH',
        payload: { name: 'chat/[key]', params: { key: 'bob' } },
      }),
    ).toBe(false);
  });

  it('keeps only one route when the same destination is pushed twice', () => {
    const router = responsiveStackRouter({ initialRouteName: PRIMARY_ROUTE_NAME });
    const options = {
      routeNames: [PRIMARY_ROUTE_NAME, 'chat/[key]'],
      routeParamList: {},
      routeGetIdList: {},
    };
    type RouterState = Parameters<typeof router.getStateForAction>[0];
    type RouterAction = Parameters<typeof router.getStateForAction>[1];
    let routerState = router.getInitialState(options) as RouterState;
    const push = {
      type: 'PUSH',
      payload: { name: 'chat/[key]', params: { key: 'alice' } },
    } as RouterAction;

    routerState = router.getStateForAction(routerState, push, options) as RouterState;
    const afterFirstPush = routerState;
    routerState = router.getStateForAction(routerState, push, options) as RouterState;

    expect(routerState).toBe(afterFirstPush);
    expect(routerState.routes).toHaveLength(2);
  });

  it('restores the persistent primary route when hydrating a detail deep link', () => {
    const router = responsiveStackRouter({ initialRouteName: PRIMARY_ROUTE_NAME });
    const options = {
      routeNames: [PRIMARY_ROUTE_NAME, 'chat/[key]'],
      routeParamList: {},
      routeGetIdList: {},
    };
    const routerState = router.getRehydratedState(
      {
        stale: true,
        routes: [{ name: 'chat/[key]', params: { key: 'alice' } }],
      },
      options,
    );

    expect(routerState.routes.map((route) => route.name)).toEqual([
      PRIMARY_ROUTE_NAME,
      'chat/[key]',
    ]);
    expect(routerState.index).toBe(1);
    expect(routerState.routes[1]?.params).toEqual({ key: 'alice' });
  });

  it('removes every detail route while preserving the primary route', () => {
    const deepState = {
      index: 3,
      routes: [
        { key: 'tabs', name: '(tabs)' },
        { key: 'account', name: 'account' },
        { key: 'encryption', name: 'encryption-key' },
        { key: 'appearance', name: 'appearance' },
      ],
    };

    expect(getPrimaryPaneBaseState(deepState)).toEqual({
      index: 0,
      routes: [{ key: 'tabs', name: '(tabs)' }],
    });
  });

  it('atomically reduces a deep detail history to primary plus the pushed destination', () => {
    const router = responsiveStackRouter({ initialRouteName: PRIMARY_ROUTE_NAME });
    const options = {
      routeNames: [PRIMARY_ROUTE_NAME, 'account', 'encryption-key', 'appearance'],
      routeParamList: {},
      routeGetIdList: {},
    };
    type RouterState = Parameters<typeof router.getStateForAction>[0];
    type RouterAction = Parameters<typeof router.getStateForAction>[1];
    const apply = (state: RouterState, action: RouterAction) =>
      router.getStateForAction(state, action, options) as RouterState;
    let routerState = router.getInitialState(options) as RouterState;
    routerState = apply(
      routerState,
      { type: 'PUSH', payload: { name: 'account' } },
    );
    routerState = apply(
      routerState,
      { type: 'PUSH', payload: { name: 'encryption-key' } },
    );
    const markedPush = {
      type: 'PUSH',
      payload: { name: 'appearance', singular: PRIMARY_PANE_RESET_MARKER },
    } as RouterAction;
    routerState = apply(routerState, markedPush);

    expect(routerState.routes.map((route) => route.name)).toEqual([
      PRIMARY_ROUTE_NAME,
      'appearance',
    ]);
  });
});
