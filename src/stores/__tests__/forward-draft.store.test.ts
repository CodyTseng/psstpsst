import { useForwardDraftStore } from '../forward-draft.store';

const source = {
  accountPubkey: 'account',
  sourceConversationKey: 'conversation',
  messages: [{ kind: 14, content: 'hello', tags: [] }],
};

describe('forward draft handoff', () => {
  it('keeps the payload in memory until the source consumes a completion', () => {
    const store = useForwardDraftStore.getState();
    const id = store.start(source);

    expect(useForwardDraftStore.getState().draft).toMatchObject({ id, ...source });

    store.complete(id);

    expect(useForwardDraftStore.getState().draft).toBeNull();
    expect(useForwardDraftStore.getState().completed).toEqual({
      id,
      accountPubkey: source.accountPubkey,
      sourceConversationKey: source.sourceConversationKey,
    });
    expect(store.consumeCompletion(id)).toBe(true);
    expect(useForwardDraftStore.getState().completed).toBeNull();
  });

  it('does not let an old page discard a newer draft', () => {
    const store = useForwardDraftStore.getState();
    const oldId = store.start(source);
    const currentId = store.start({ ...source, messages: [{ kind: 14, content: 'new', tags: [] }] });

    store.discard(oldId);

    expect(useForwardDraftStore.getState().draft?.id).toBe(currentId);
    store.discard(currentId);
  });

  it('does not leave a chat completion for a profile-card share', () => {
    const store = useForwardDraftStore.getState();
    const id = store.start({ ...source, sourceConversationKey: null });

    store.complete(id);

    expect(useForwardDraftStore.getState().draft).toBeNull();
    expect(useForwardDraftStore.getState().completed).toBeNull();
  });
});
