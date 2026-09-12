import { create } from 'zustand';

import type { ForwardMessage } from '@/lib/share/forward';

/**
 * Ephemeral handoff between a message source and the route-based forward picker.
 *
 * The payload deliberately stays in memory: attachment tags can be large and
 * must not be serialized into the URL. Chat-originated handoffs retain their
 * source only long enough for that chat to leave selection mode after the route
 * pops. Profile-card and emoji-pack shares have no source conversation.
 */
export type ForwardDraft = {
  id: number;
  accountPubkey: string;
  sourceConversationKey: string | null;
  /** Relay recipient excluded by the share source, such as the card's owner. */
  excludedRelayPubkey?: string | null;
  messages: ForwardMessage[];
};

type CompletedForward = Pick<ForwardDraft, 'id' | 'accountPubkey' | 'sourceConversationKey'>;

type State = {
  draft: ForwardDraft | null;
  completed: CompletedForward | null;
  start: (draft: Omit<ForwardDraft, 'id'>) => number;
  complete: (id: number) => void;
  discard: (id: number) => void;
  consumeCompletion: (id: number) => boolean;
};

let nextDraftId = 0;

export const useForwardDraftStore = create<State>((set) => ({
  draft: null,
  completed: null,
  start: (draft) => {
    const id = ++nextDraftId;
    set({ draft: { ...draft, id }, completed: null });
    return id;
  },
  complete: (id) =>
    set((state) => {
      const draft = state.draft;
      if (!draft || draft.id !== id) return state;
      return {
        draft: null,
        completed:
          draft.sourceConversationKey === null
            ? null
            : {
                id: draft.id,
                accountPubkey: draft.accountPubkey,
                sourceConversationKey: draft.sourceConversationKey,
              },
      };
    }),
  discard: (id) =>
    set((state) => (state.draft?.id === id ? { draft: null } : state)),
  consumeCompletion: (id) => {
    let consumed = false;
    set((state) => {
      if (state.completed?.id !== id) return state;
      consumed = true;
      return { completed: null };
    });
    return consumed;
  },
}));
