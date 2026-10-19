import type { Event } from 'nostr-tools';
import type { ApplicationMessagingPort } from './application-messaging';

export type ApplicationWindowLaunch = { accountPubkey: string; address: string; manifest?: Event; servers?: string[]; reviewedRequired?: string[] };
export type ApplicationWindowAction =
  | { type: 'visited'; accountPubkey: string; key: string }
  | { type: 'profile'; pubkey: string }
  | { type: 'share'; accountPubkey: string; title: string; address: string };
export type ApplicationSigningChange = { accountPubkey: string; sourceId: string; key?: string };
export type RunningApplication = { accountPubkey: string; sourceId: string };

/** Trusted application hosts share persistence while keeping their runtime and overlays local. */
export interface ApplicationWindowsPort {
  readonly messaging?: ApplicationMessagingPort;
  readonly isHost: boolean;
  open(launch: ApplicationWindowLaunch): Promise<void>;
  launch(): Promise<ApplicationWindowLaunch | null>;
  running(): Promise<RunningApplication[]>;
  onRunningChange(listener: (applications: RunningApplication[]) => void): () => void;
  close(): Promise<void>;
  closeAll(accountPubkey?: string): Promise<void>;
  action(action: ApplicationWindowAction): Promise<void>;
  onAction(listener: (action: ApplicationWindowAction) => void): () => void;
  broadcastSigning(change: ApplicationSigningChange): Promise<void>;
  onSigningChange(listener: (change: ApplicationSigningChange) => void): () => void;
}
