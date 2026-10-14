type RouteState = {
  index?: number;
  routes: readonly {
    name: string;
    params?: object;
    state?: RouteState;
  }[];
};

/** Read actual visible panes, including the selected tab behind a wide detail. */
export function incomingMessageVisibility(state: RouteState, wide: boolean) {
  const active = state.routes[state.index ?? 0];
  const primary = state.routes.find((route) => route.name === '(tabs)');
  const tabs = primary?.state;
  const selectedTab = tabs?.routes[tabs.index ?? 0]?.name ?? 'index';
  const chatsVisible = !!primary && selectedTab === 'index' &&
    (wide || active === primary);
  const key = active?.name === 'chat/[key]' && active.params && 'key' in active.params
    ? active.params.key : null;

  return {
    chatsVisible,
    activeConversationKey: typeof key === 'string' ? key : null,
  };
}
