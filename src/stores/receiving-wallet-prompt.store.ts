import { create } from 'zustand';

type ReceivingWalletPrompt = {
  accountPubkey: string;
  walletId: string;
  address: string;
};

type State = {
  pending: ReceivingWalletPrompt | null;
  queue: (prompt: ReceivingWalletPrompt) => void;
  consume: (accountPubkey: string) => ReceivingWalletPrompt | null;
};

export const useReceivingWalletPromptStore = create<State>((set, get) => ({
  pending: null,
  queue: (pending) => set({ pending }),
  consume: (accountPubkey) => {
    const pending = get().pending;
    if (!pending || pending.accountPubkey !== accountPubkey) return null;
    set({ pending: null });
    return pending;
  },
}));
