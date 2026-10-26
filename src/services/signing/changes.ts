import type { ApplicationWindowsPort } from '@/platform/ports/application-window';
import type { SigningAccountScope } from './repository';

type Change = { key?: string; revision: number };
const channels = new Map<string, { revision: number; listeners: Set<(change: Change) => void> }>();
const identity = (scope: SigningAccountScope) => JSON.stringify([scope.accountPubkey, scope.sourceId]);
export function signingRevision(scope: SigningAccountScope): number { return channels.get(identity(scope))?.revision ?? 0; }
let windows: ApplicationWindowsPort | undefined;
let detach: (() => void) | undefined;
/** The trusted host connects transport after installing platform adapters. */
export function connectSigningWindows(port?: ApplicationWindowsPort) {
  if (windows === port) return;
  detach?.(); windows = port;
  detach = port?.onSigningChange(change => invalidateLocal(change, change.key));
}
export function subscribeSigning(scope: SigningAccountScope, listener: (change: Change) => void) {
  const key = identity(scope);
  let channel = channels.get(key);
  if (!channel) { channel = { revision: 0, listeners: new Set() }; channels.set(key, channel); }
  channel.listeners.add(listener);
  return () => { channel.listeners.delete(listener); if (!channel.listeners.size) channels.delete(key); };
}
export function invalidateSigning(scope: SigningAccountScope, key?: string): number {
  void windows?.broadcastSigning({ ...scope, key }).catch(() => {});
  return invalidateLocal(scope, key);
}
function invalidateLocal(scope: SigningAccountScope, key?: string): number {
  const channel = channels.get(identity(scope));
  if (!channel) return 0;
  const revision = ++channel.revision;
  for (const listener of channel.listeners) listener({ key, revision });
  return revision;
}
export function invalidateSigningAccount(accountPubkey: string): void {
  for (const key of channels.keys()) {
    const [account, sourceId] = JSON.parse(key) as [string, string];
    if (account === accountPubkey) invalidateSigning({ accountPubkey, sourceId });
  }
}
