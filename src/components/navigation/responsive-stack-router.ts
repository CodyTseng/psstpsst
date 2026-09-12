import { StackRouter } from 'expo-router/build/layouts/StackClient';

export const PRIMARY_ROUTE_NAME = '(tabs)';

// Expo Router carries this function identity on the generated PUSH action. It
// never becomes a URL parameter and is removed before delegating to StackRouter.
// Returning undefined also makes it a safe no-op if an unrelated router sees it.
export const PRIMARY_PANE_RESET_MARKER = () => undefined;

type RouteFocusState = {
  index: number;
  routes: readonly { key: string; name: string; params?: object }[];
};

type RouterAction = {
  type: string;
  payload?: {
    name?: string;
    params?: object;
    singular?: unknown;
    [key: string]: unknown;
  };
};

function navigationValueEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => navigationValueEqual(value, right[index]));
  }
  if (
    left == null ||
    right == null ||
    typeof left !== 'object' ||
    typeof right !== 'object'
  ) {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).filter((key) => leftRecord[key] !== undefined);
  const rightKeys = Object.keys(rightRecord).filter((key) => rightRecord[key] !== undefined);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(rightRecord, key) &&
        navigationValueEqual(leftRecord[key], rightRecord[key]),
    )
  );
}

/** A push to the exact route already on top is idempotent. This lives in the
 * router so queued double taps are handled after the first action updates the
 * stack, including while the native transition is still running. */
export function isDuplicateActivePush(
  state: RouteFocusState,
  action: RouterAction,
): boolean {
  if (action.type !== 'PUSH' || !action.payload?.name) return false;
  const activeRoute = state.routes[state.index];
  return (
    activeRoute?.name === action.payload.name &&
    navigationValueEqual(activeRoute.params, action.payload.params)
  );
}

export function shouldKeepDetailFocused(state: RouteFocusState, targetKey: string): boolean {
  const activeRoute = state.routes[state.index];
  const targetRoute = state.routes.find((route) => route.key === targetKey);

  return targetRoute?.name === PRIMARY_ROUTE_NAME && activeRoute?.name !== PRIMARY_ROUTE_NAME;
}

export function isPrimaryPaneResetAction(action: RouterAction): boolean {
  return action.type === 'PUSH' && action.payload?.singular === PRIMARY_PANE_RESET_MARKER;
}

export function getPrimaryPaneBaseState<State extends RouteFocusState>(state: State): State {
  const primaryRoute = state.routes.find((route) => route.name === PRIMARY_ROUTE_NAME);
  if (!primaryRoute) return state;
  return { ...state, index: 0, routes: [primaryRoute] } as State;
}

function withoutPrimaryPaneMarker<Action extends RouterAction>(action: Action): Action {
  if (!action.payload) return action;
  const { singular: _singular, ...payload } = action.payload;
  return { ...action, payload };
}

/** Lets the persistent primary tabs change their nested state without making
 * the parent stack discard the detail route that is still visible beside them. */
export const responsiveStackRouter: typeof StackRouter = (options) => {
  const router = StackRouter(options);

  return {
    ...router,
    getRehydratedState(partialState, routerOptions) {
      const state = router.getRehydratedState(partialState, routerOptions);
      if (state.routes.some((route) => route.name === PRIMARY_ROUTE_NAME)) return state;

      const primaryRoute = router
        .getInitialState(routerOptions)
        .routes.find((route) => route.name === PRIMARY_ROUTE_NAME);
      if (!primaryRoute) return state;

      return {
        ...state,
        index: state.index + 1,
        routes: [primaryRoute, ...state.routes],
      };
    },
    getStateForAction(state, action, routerOptions) {
      if (isDuplicateActivePush(state, action)) return state;
      if (isPrimaryPaneResetAction(action)) {
        return router.getStateForAction(
          getPrimaryPaneBaseState(state),
          withoutPrimaryPaneMarker(action),
          routerOptions,
        );
      }
      return router.getStateForAction(state, action, routerOptions);
    },
    getStateForRouteFocus(state, key) {
      if (shouldKeepDetailFocused(state, key)) return state;
      return router.getStateForRouteFocus(state, key);
    },
  };
};
