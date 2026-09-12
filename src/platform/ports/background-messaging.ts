export type BackgroundMessagingContent = {
  /** Android notification-channel label. */
  channelName: string;
  /** Content-free explanation shown in the ongoing foreground-service notification. */
  message: string;
};

/**
 * Keeps the mobile messaging process eligible to run while the app is away.
 * Android implements this with a user-visible `remoteMessaging` foreground
 * service; runtimes without that capability expose an unavailable no-op.
 */
export interface BackgroundMessagingPort {
  isAvailable(): boolean;
  /** Whether Android currently exempts this app from Doze battery optimization. */
  isBatteryOptimizationExempt(): Promise<boolean>;
  /** Open Android's app-specific battery-optimization exemption request. */
  requestBatteryOptimizationExemption(): Promise<boolean>;
  /** Subscribe to the one-shot native deadline used when OEMs suspend RN timers. */
  addPulseListener(listener: () => void): () => void;
  /** Replace the pending deadline (Unix milliseconds); null cancels it. */
  schedulePulse(deadline: number | null): Promise<void>;
  start(content: BackgroundMessagingContent): Promise<boolean>;
  stop(): Promise<void>;
}
