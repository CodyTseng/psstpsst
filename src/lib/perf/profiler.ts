import { IS_DEVELOPMENT_BUILD } from '@/lib/environment';

type PerfAttrs = Record<string, string | number | boolean | null | undefined>;

type PerfStep = {
  name: string;
  ms: number;
};

type PerfStat = {
  count: number;
  total: number;
  max: number;
  slow: number;
};

declare global {
  // Set from a local debug session when profiling is explicitly needed.
  // It stays off by default so development builds do not spam perf logs.
  var __PSSTPSST_PERF_LOGS__: boolean | undefined;
}

const ENABLED =
  IS_DEVELOPMENT_BUILD && globalThis.__PSSTPSST_PERF_LOGS__ === true;
const SLOW_STEP_MS = 8;
const SLOW_SPAN_MS = 32;
const STATS_FLUSH_MS = 10_000;
const EVENT_LOOP_INTERVAL_MS = 50;
const EVENT_LOOP_LAG_MS = 100;

const stats = new Map<string, PerfStat>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let eventLoopMonitorStarted = false;

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function formatMs(ms: number): string {
  return `${ms.toFixed(1)}ms`;
}

function formatAttrs(attrs?: PerfAttrs): string {
  if (!attrs) return '';
  const pairs = Object.entries(attrs).filter(([, value]) => value != null);
  if (pairs.length === 0) return '';
  return ` ${pairs.map(([key, value]) => `${key}=${String(value)}`).join(' ')}`;
}

function scheduleFlush(): void {
  if (!ENABLED || flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushPerfStats('interval');
  }, STATS_FLUSH_MS);
}

export function recordPerfMetric(name: string, ms: number): void {
  if (!ENABLED) return;
  const prev = stats.get(name) ?? { count: 0, total: 0, max: 0, slow: 0 };
  prev.count += 1;
  prev.total += ms;
  prev.max = Math.max(prev.max, ms);
  if (ms >= SLOW_STEP_MS) prev.slow += 1;
  stats.set(name, prev);
  scheduleFlush();
}

export function flushPerfStats(reason: string): void {
  if (!ENABLED || stats.size === 0) return;
  const rows = [...stats.entries()]
    .map(([name, stat]) => ({
      name,
      count: stat.count,
      avg: stat.total / stat.count,
      max: stat.max,
      slow: stat.slow,
      total: stat.total,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);
  console.info(
    `[perf:stats] ${reason}\n` +
      rows
        .map(
          (row) =>
            `${row.name} count=${row.count} avg=${formatMs(row.avg)} max=${formatMs(
              row.max,
            )} slow=${row.slow} total=${formatMs(row.total)}`,
        )
        .join('\n'),
  );
  stats.clear();
}

export class PerfSpan {
  private readonly startedAt = now();
  private readonly steps: PerfStep[] = [];

  constructor(
    private readonly name: string,
    private readonly attrs?: PerfAttrs,
  ) {}

  async step<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const startedAt = now();
    try {
      return await fn();
    } finally {
      this.addStep(name, now() - startedAt);
    }
  }

  stepSync<T>(name: string, fn: () => T): T {
    const startedAt = now();
    try {
      return fn();
    } finally {
      this.addStep(name, now() - startedAt);
    }
  }

  mark(name: string, ms: number): void {
    this.addStep(name, ms);
  }

  end(attrs?: PerfAttrs): void {
    if (!ENABLED) return;
    const total = now() - this.startedAt;
    recordPerfMetric(`${this.name}.total`, total);
    const maxStep = this.steps.reduce((max, step) => Math.max(max, step.ms), 0);
    if (total < SLOW_SPAN_MS && maxStep < SLOW_STEP_MS) return;
    const stepText = this.steps.map((step) => `${step.name}=${formatMs(step.ms)}`).join(' ');
    console.info(
      `[perf] ${this.name} total=${formatMs(total)}${formatAttrs({
        ...this.attrs,
        ...attrs,
      })} ${stepText}`,
    );
  }

  private addStep(name: string, ms: number): void {
    if (!ENABLED) return;
    this.steps.push({ name, ms });
    recordPerfMetric(`${this.name}.${name}`, ms);
  }
}

export function createPerfSpan(name: string, attrs?: PerfAttrs): PerfSpan | null {
  return ENABLED ? new PerfSpan(name, attrs) : null;
}

export async function profileAsync<T>(
  span: PerfSpan | null | undefined,
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  return span ? span.step(name, fn) : fn();
}

export function profileSync<T>(
  span: PerfSpan | null | undefined,
  name: string,
  fn: () => T,
): T {
  return span ? span.stepSync(name, fn) : fn();
}

export function startEventLoopLagMonitor(label = 'js'): void {
  if (!ENABLED || eventLoopMonitorStarted) return;
  eventLoopMonitorStarted = true;
  let expected = now() + EVENT_LOOP_INTERVAL_MS;
  setInterval(() => {
    const current = now();
    const lag = current - expected;
    if (lag >= EVENT_LOOP_LAG_MS) {
      recordPerfMetric(`${label}.eventLoopLag`, lag);
      console.warn(`[perf:lag] ${label} blocked ${formatMs(lag)}`);
    }
    expected = current + EVENT_LOOP_INTERVAL_MS;
  }, EVENT_LOOP_INTERVAL_MS);
}
