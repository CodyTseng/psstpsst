/** Minimum wait after a relay explicitly rate-limits publication. */
export const RELAY_RATE_LIMIT_BACKOFF_MS = 30_000;
export const MAX_RELAY_RETRY_TIMER_MS = 0x7fffffff;

export class RelayPublishRejection extends Error {
  constructor(reason: string, readonly retryAfterMs?: number) {
    super(reason);
  }
}

/** NIP-01 sends a positive decimal string measured in milliseconds. */
export function parseRelayRetryAfterMs(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return undefined;
  const duration = Number(value);
  return Number.isSafeInteger(duration) ? duration : undefined;
}

export function relayRetryDeadline(now: number, delayMs: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, now + delayMs);
}

/** Recognize the protocol prefix and common spellings of rate limiting. */
export function isRelayRateLimit(reason: string): boolean {
  if (/^\s*(?:auth-required|blocked|duplicate|invalid|pow|restricted):/i.test(reason)) return false;
  return /\b(?:rate[\s_-]*limit(?:ed|ing)?|too many requests)\b/i.test(reason);
}
