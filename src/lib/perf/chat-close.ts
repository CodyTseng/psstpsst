type CloseSample = {
  requestedAt: number;
  removalRequestedMs?: number;
  transitionStartedMs?: number;
  transitionEndedMs?: number;
  layoutCleanupMs?: number;
  passiveCleanupMs?: number;
  nextTaskMs?: number;
};

const samples: CloseSample[] = [];
let current: CloseSample | undefined;
const now = () => globalThis.performance?.now?.() ?? Date.now();
let mountedBubbles = 0;
let scopeStarts = new Map<string, number>();

/** Count mounted bubbles, not retained message data. No per-row logging. */
export function trackMountedChatBubble(): () => void {
  mountedBubbles += 1;
  return () => { mountedBubbles -= 1; };
}

export function markChatCleanupScope(
  scope: string,
  phase: 'layout' | 'passive',
  edge: 'start' | 'end',
): void {
  if (!current || current.nextTaskMs !== undefined) return;
  const key = `${scope}.${phase}`;
  const time = now();
  if (edge === 'start') scopeStarts.set(key, time);
  const startedAt = scopeStarts.get(key);
  console.info(`[chat-perf] cleanup.${key}.${edge}`, {
    sinceRequestMs: Math.round(time - current.requestedAt),
    ...(edge === 'end' && startedAt !== undefined
      ? { durationMs: Math.round(time - startedAt) }
      : {}),
    mountedBubbles,
  });
  if (edge === 'end') scopeStarts.delete(key);
}

/** Bounded, memory-only diagnostics available in release builds as well.
 * Contains durations only, never conversation identifiers or message content. */
export function beginChatCloseTrace(): void {
  current = { requestedAt: now() };
  scopeStarts = new Map();
  samples.push(current);
  if (samples.length > 20) samples.shift();
  console.info('[chat-perf] close.request', { mountedBubbles });
  const sample = current;
  setTimeout(() => {
    console.info('[chat-perf] close.firstTask', {
      elapsedMs: Math.round(now() - sample.requestedAt),
    });
  }, 0);
}

export function markChatClosePhase(
  phase: Exclude<keyof CloseSample, 'requestedAt'>,
): void {
  if (phase === 'removalRequestedMs' && (!current || current.passiveCleanupMs !== undefined)) {
    beginChatCloseTrace();
  }
  if (!current || current[phase] !== undefined) return;
  current[phase] = now() - current.requestedAt;
  console.info(`[chat-perf] close.${phase}`, Math.round(current[phase]));
  if (phase === 'passiveCleanupMs') {
    const sample = current;
    setTimeout(() => {
      sample.nextTaskMs = now() - sample.requestedAt;
      console.info('[chat-perf] close.afterCleanupTask', Math.round(sample.nextTaskMs));
    }, 0);
  }
}

export function getChatCloseSamples(): readonly CloseSample[] {
  return samples.map((sample) => ({ ...sample }));
}
