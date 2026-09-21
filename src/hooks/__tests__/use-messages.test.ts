import type { messages } from '@/db/schema';

import {
  mergeNewestFirstRows,
} from '@/lib/message-window';

type MessageRow = typeof messages.$inferSelect;

function row(id: string, orderAt: number): MessageRow {
  return { id, orderAt } as MessageRow;
}

describe('message window paging', () => {
  it('merges overlapping cursor pages in chronology order', () => {
    const merged = mergeNewestFirstRows(
      [row('a', 500), row('c', 300)],
      [row('b', 400), row('c', 300), row('d', 200)],
    );

    expect(merged.map((message) => message.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('uses the event id as the descending chronology tie-break', () => {
    const merged = mergeNewestFirstRows(
      [row('a', 500), row('d', 400)],
      [row('b', 500), row('c', 400)],
    );

    expect(merged.map((message) => message.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps existing row indices and identities when adding an older page', () => {
    const rows = [row('a', 500), row('b', 400), row('c', 300), row('d', 200)];
    const merged = mergeNewestFirstRows(rows, [row('e', 100)]);
    rows.forEach((message, index) => expect(merged[index]).toBe(message));
    expect(merged).toHaveLength(5);
  });
});
