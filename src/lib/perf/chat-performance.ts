/** Temporary, low-frequency diagnostics for Android release testing.
 * Never pass message text, identifiers, keys, or URLs to these records. */
export function logChatPerformance(
  phase: string,
  metrics: Record<string, number | boolean>,
): void {
  console.info(`[chat-perf] ${phase}`, metrics);
}

export const chatPerformanceNow = () => globalThis.performance?.now?.() ?? Date.now();
