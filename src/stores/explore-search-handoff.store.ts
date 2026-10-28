import { create } from 'zustand';

type Handoff = { id: number; account: string; value: string; action?: { name: string; auxiliary: boolean } };
type State = {
  pending: Handoff | null;
  start(input: Omit<Handoff, 'id'>): number;
  consume(id: number, account: string): void;
};
let nextId = 0;

/** Hand scan input or an action filter to the Explore tab without putting URLs or addresses in route params. */
export const useExploreSearchHandoffStore = create<State>((set, get) => ({
  pending: null,
  start(input) {
    const id = ++nextId;
    set({ pending: { ...input, id } });
    return id;
  },
  consume(id, account) {
    const pending = get().pending;
    if (pending?.id === id && pending.account === account) set({ pending: null });
  },
}));
