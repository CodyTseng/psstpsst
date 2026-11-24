import { useCallback, useEffect, useState } from 'react';

import type { messages } from '@/db/schema';
import { isMessageOrderNewer, type MessageOrderKey } from '@/lib/nostr/message-order';
import { messageRemovalTiming } from '@/theme/motion';

type MessageRow = typeof messages.$inferSelect;
const EMPTY_ROWS: ReadonlyMap<string, MessageRow> = new Map();

export function messageInsertionIndex(rows: readonly MessageRow[], cursor: MessageOrderKey): number {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (isMessageOrderNewer(cursor, rows[middle])) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function includeRemovingMessages(
  messages: MessageRow[],
  displayedCount: number,
  removing: ReadonlyMap<string, MessageRow>,
): MessageRow[] {
  const rows = messages.slice(0, displayedCount);
  for (const row of removing.values()) {
    const index = messageInsertionIndex(rows, row);
    if (rows[index]?.id !== row.id) rows.splice(index, 0, row);
  }
  return rows;
}

/** Keep only previously visible deletions in the display while they collapse.
 * The persisted history and pagination cursors already exclude them. */
export function useRemovingMessages({
  scope, deletedIds, reduceMotion, defer, visibleRows,
}: {
  scope: string;
  deletedIds: ReadonlySet<string> | undefined;
  reduceMotion: boolean;
  defer: boolean;
  visibleRows: () => MessageRow[];
}) {
  const [state, setState] = useState({ scope, deletedIds, rows: EMPTY_ROWS });
  if (state.scope !== scope || (reduceMotion && state.rows.size > 0)) {
    setState({ scope, deletedIds, rows: EMPTY_ROWS });
  } else if (state.deletedIds !== deletedIds) {
    const rows = new Map(state.rows);
    if (!reduceMotion && deletedIds?.size) {
      for (const row of visibleRows()) {
        if (deletedIds.has(row.id) && !state.deletedIds?.has(row.id)) rows.set(row.id, row);
      }
    }
    setState({ scope, deletedIds, rows: rows.size ? rows : EMPTY_ROWS });
  }

  const finish = useCallback((id: string) => {
    setState((current) => {
      if (current.scope !== scope || !current.rows.has(id)) return current;
      const rows = new Map(current.rows);
      rows.delete(id);
      return { ...current, rows: rows.size ? rows : EMPTY_ROWS };
    });
  }, [scope]);

  useEffect(() => {
    if (defer || state.rows.size === 0) return;
    // A virtualized row may unmount before it can report completion.
    const timer = setTimeout(() => {
      setState((current) => current === state ? { ...current, rows: EMPTY_ROWS } : current);
    }, messageRemovalTiming.duration + 250);
    return () => clearTimeout(timer);
  }, [defer, state]);

  return { removing: state.rows, finish };
}
