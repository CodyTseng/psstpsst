type ChatRuntimeModule = typeof import('./ChatPageRuntime');

let runtimePromise: Promise<ChatRuntimeModule> | null = null;

export function loadChatPageRuntime(): Promise<ChatRuntimeModule> {
  if (!runtimePromise) {
    runtimePromise = import('./ChatPageRuntime');
  }
  return runtimePromise;
}
