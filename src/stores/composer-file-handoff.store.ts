import { create } from 'zustand';

import type { ComposerFile } from '@/lib/attachments/composer-file';

export type ComposerFileHandoff = {
  id: number;
  accountPubkey: string;
  conversationKey: string;
  files: ComposerFile[];
};

type State = {
  handoff: ComposerFileHandoff | null;
  start: (handoff: Omit<ComposerFileHandoff, 'id'>) => number;
  discard: (id: number) => void;
};

let nextHandoffId = 0;

/** In-memory browser File handoff from a conversation row to its chat route. */
export const useComposerFileHandoffStore = create<State>((set) => ({
  handoff: null,
  start: (handoff) => {
    const id = ++nextHandoffId;
    set({ handoff: { ...handoff, id } });
    return id;
  },
  discard: (id) =>
    set((state) => (state.handoff?.id === id ? { handoff: null } : state)),
}));
