import type { IncomingShareItem } from '@/lib/share/incoming-share';

import { incomingBackupCandidate } from '../incoming-backup';

function file(name: string): IncomingShareItem {
  return {
    kind: 'file',
    id: name,
    localUri: `file:///shared/${name}`,
    mime: 'application/octet-stream',
    name,
  };
}

describe('incomingBackupCandidate', () => {
  test.each(['history.zip', 'history.jsonl', 'history.NDJSON'])(
    'accepts one shared %s backup',
    (name) => {
      expect(incomingBackupCandidate([file(name)])).toEqual(file(name));
    },
  );

  it('does not offer import for unrelated files or text', () => {
    expect(incomingBackupCandidate([file('notes.json')])).toBeNull();
    expect(
      incomingBackupCandidate([{ kind: 'text', id: 'text', content: 'history.zip' }]),
    ).toBeNull();
  });

  it('does not silently discard other shared items', () => {
    expect(incomingBackupCandidate([file('one.zip'), file('two.zip')])).toBeNull();
  });
});
