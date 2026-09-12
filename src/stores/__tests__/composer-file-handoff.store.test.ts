import type { BrowserFile } from '@/lib/attachments/composer-file';
import { useComposerFileHandoffStore } from '../composer-file-handoff.store';

function files(name: string) {
  const file = { name, type: 'text/plain', size: 4 } as BrowserFile;
  return [{ file, name, mime: 'text/plain', size: 4 }];
}

describe('composer file handoff', () => {
  afterEach(() => useComposerFileHandoffStore.setState({ handoff: null }));

  it('keeps browser files in memory for the destination conversation', () => {
    const id = useComposerFileHandoffStore.getState().start({
      accountPubkey: 'account',
      conversationKey: 'alice',
      files: files('notes.txt'),
    });

    expect(useComposerFileHandoffStore.getState().handoff).toMatchObject({
      id,
      accountPubkey: 'account',
      conversationKey: 'alice',
      files: [{ name: 'notes.txt' }],
    });
  });

  it('does not let a stale dialog discard a newer handoff', () => {
    const first = useComposerFileHandoffStore.getState().start({
      accountPubkey: 'account',
      conversationKey: 'alice',
      files: files('first.txt'),
    });
    const second = useComposerFileHandoffStore.getState().start({
      accountPubkey: 'account',
      conversationKey: 'bob',
      files: files('second.txt'),
    });

    useComposerFileHandoffStore.getState().discard(first);
    expect(useComposerFileHandoffStore.getState().handoff?.id).toBe(second);
    useComposerFileHandoffStore.getState().discard(second);
    expect(useComposerFileHandoffStore.getState().handoff).toBeNull();
  });
});
