import { recordPerfMetric } from './profiler';

type ChatOpenTrace = {
  conversationKey: string;
  pressInAt: number;
  navigationAt: number | null;
  routeCommitted: boolean;
  composerMounted: boolean;
  messageListMounted: boolean;
};

let activeTrace: ChatOpenTrace | null = null;
const inputPressAtByConversation = new Map<string, number>();
const panelRequestAtByConversation = new Map<string, number>();

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

export function beginChatOpenTrace(conversationKey: string): void {
  activeTrace = {
    conversationKey,
    pressInAt: now(),
    navigationAt: null,
    routeCommitted: false,
    composerMounted: false,
    messageListMounted: false,
  };
}

export function markChatNavigation(conversationKey: string): void {
  const trace = activeTrace;
  if (!trace || trace.conversationKey !== conversationKey) return;
  trace.navigationAt = now();
  recordPerfMetric('chat.open.pressInToNavigation', trace.navigationAt - trace.pressInAt);
}

export function markChatRouteCommit(conversationKey: string): void {
  const trace = activeTrace;
  if (!trace || trace.conversationKey !== conversationKey || trace.routeCommitted) return;
  trace.routeCommitted = true;
  const committedAt = now();
  recordPerfMetric('chat.open.pressInToRouteCommit', committedAt - trace.pressInAt);
  if (trace.navigationAt != null) {
    recordPerfMetric('chat.open.navigationToRouteCommit', committedAt - trace.navigationAt);
  }
}

export function markChatComposerMounted(conversationKey: string): void {
  const trace = activeTrace;
  if (!trace || trace.conversationKey !== conversationKey || trace.composerMounted) return;
  trace.composerMounted = true;
  recordPerfMetric('chat.open.pressInToComposerMount', now() - trace.pressInAt);
}

export function markChatMessageListMounted(conversationKey: string): void {
  const trace = activeTrace;
  if (!trace || trace.conversationKey !== conversationKey || trace.messageListMounted) return;
  trace.messageListMounted = true;
  recordPerfMetric('chat.open.pressInToMessageListMount', now() - trace.pressInAt);
}

export function markChatInputPress(conversationKey: string): void {
  inputPressAtByConversation.set(conversationKey, now());
}

export function markChatInputFocus(conversationKey: string): void {
  const pressedAt = inputPressAtByConversation.get(conversationKey);
  if (pressedAt == null) return;
  recordPerfMetric('chat.input.pressToFocus', now() - pressedAt);
}

export function markChatKeyboardEvent(
  conversationKey: string,
  phase: 'willShow' | 'didShow',
): void {
  const pressedAt = inputPressAtByConversation.get(conversationKey);
  if (pressedAt == null) return;
  recordPerfMetric(`chat.input.pressToKeyboard${phase}`, now() - pressedAt);
  if (phase === 'didShow') inputPressAtByConversation.delete(conversationKey);
}

export function markChatPanelRequest(conversationKey: string): void {
  panelRequestAtByConversation.set(conversationKey, now());
}

export function markChatPanelCommit(conversationKey: string): void {
  const requestedAt = panelRequestAtByConversation.get(conversationKey);
  if (requestedAt == null) return;
  recordPerfMetric('chat.panel.requestToCommit', now() - requestedAt);
  panelRequestAtByConversation.delete(conversationKey);
}
