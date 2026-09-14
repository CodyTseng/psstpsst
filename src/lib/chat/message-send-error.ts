export type MessageSendFailure =
  | { kind: 'not_ready' }
  | { kind: 'reason'; reason: string }
  | { kind: 'unknown' };

const NOT_READY_REASONS = new Set([
  'DM service not initialized',
  'DM service not initialized for this account',
]);

/** Preserve an actionable rejection reason while translating known internal
 * readiness errors into user-facing copy at the UI boundary. */
export function classifyMessageSendFailure(error: unknown): MessageSendFailure {
  const reason =
    error instanceof Error
      ? error.message.trim()
      : typeof error === 'string'
        ? error.trim()
        : '';

  if (NOT_READY_REASONS.has(reason)) return { kind: 'not_ready' };
  if (reason) return { kind: 'reason', reason };
  return { kind: 'unknown' };
}
