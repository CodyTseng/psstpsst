import { create } from 'zustand';

import type { CustomEmoji } from '@/lib/nostr/custom-emoji';

type State = {
  emoji: CustomEmoji | null;
  open: (emoji: CustomEmoji) => void;
  close: () => void;
};

export const useCustomEmojiDetail = create<State>((set) => ({
  emoji: null,
  open: (emoji) => set({ emoji }),
  close: () => set({ emoji: null }),
}));

export function showCustomEmojiDetail(emoji: CustomEmoji) {
  useCustomEmojiDetail.getState().open(emoji);
}
