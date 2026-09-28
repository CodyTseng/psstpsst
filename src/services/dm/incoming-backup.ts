import type { IncomingShareFile, IncomingShareItem } from '@/lib/share/incoming-share';

import { backupImportKind } from './dm-backup-format';

/** Return the sole shared file when it can be imported as chat history. */
export function incomingBackupCandidate(
  items: readonly IncomingShareItem[],
): IncomingShareFile | null {
  if (items.length !== 1) return null;
  const item = items[0];
  if (item.kind !== 'file') return null;
  return backupImportKind(item.name ?? item.localUri) ? item : null;
}
