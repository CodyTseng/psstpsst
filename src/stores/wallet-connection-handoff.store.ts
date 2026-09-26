import { create } from 'zustand';

type WalletConnectionHandoff = {
  id: number;
  accountPubkey: string;
  connectionString: string;
};

type State = {
  pending: WalletConnectionHandoff | null;
  start: (handoff: Omit<WalletConnectionHandoff, 'id'>) => number;
  consume: (id: number, accountPubkey: string) => string | null;
};

let nextHandoffId = 0;

/** Keeps an NWC secret out of route params while the scanner opens the add-wallet flow. */
export const useWalletConnectionHandoffStore = create<State>((set, get) => ({
  pending: null,
  start: (handoff) => {
    const id = ++nextHandoffId;
    set({ pending: { ...handoff, id } });
    return id;
  },
  consume: (id, accountPubkey) => {
    const pending = get().pending;
    if (!pending || pending.id !== id || pending.accountPubkey !== accountPubkey) return null;
    set({ pending: null });
    return pending.connectionString;
  },
}));
