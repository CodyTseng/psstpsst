/**
 * Port for the periodic background task (WorkManager on Android, BGTaskScheduler
 * on iOS, a main-process timer on desktop). The poll's business logic stays in
 * `services/notifications/background-task.ts`; this port handles defining and
 * (un)registering the OS-level task.
 *
 * Timing constraint: `defineTasks` must run at module scope during bundle load —
 * the OS can cold-launch the app straight into the task, so registration cannot
 * wait for React to mount. Callers therefore define from a module that the root
 * layout imports eagerly.
 *
 * Implementations tolerate the capability being absent: `defineTasks` becomes a
 * no-op and register/unregister resolve without effect.
 */
export type BackgroundTaskExecution = {
  /** Aborted when the OS expires the current execution window. */
  signal: AbortSignal;
};

export interface BackgroundTaskPort {
  /**
   * Define the task under each of `names` (the first is the current name, the
   * rest legacy aliases kept so already-scheduled OS tasks still resolve).
   * `run` is the poll body; a thrown error marks the run as failed, anything
   * else as successful. No-op when the capability is absent.
   */
  defineTasks(
    names: string[],
    run: (execution: BackgroundTaskExecution) => Promise<void>,
  ): void;
  /**
   * Ask the OS to schedule the task (floor interval in minutes; the OS decides
   * the real cadence). Also unschedules legacy aliases. Never rejects.
   */
  register(minimumIntervalMinutes: number): Promise<void>;
  /** Cancel the OS schedule for the current task name. Never rejects. */
  unregister(): Promise<void>;
}
