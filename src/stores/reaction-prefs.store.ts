import { create } from 'zustand';

import {
  normalizeStoredQuickReactions,
  type QuickReaction,
} from '@/lib/nostr/quick-reaction';
import {
  getDevicePreference,
  trySetDevicePreference,
} from '@/services/preferences/device-preferences.service';

/** Device-level chat preference (cf. chat-prefs.store): which reactions appear in
 * the long-press reaction pill, in display order. */
const QUICK_REACTIONS_KEY = 'chat.quickReactions';

/** The out-of-the-box quick reactions; also defines how many slots the pill has. */
export const DEFAULT_QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] satisfies QuickReaction[];

type State = {
  /** Unicode or custom emoji shown in the reaction pill, in display order. */
  quickEmojis: QuickReaction[];
  load: () => Promise<void>;
  /** Replace the whole ordered set, then persist. */
  setQuickEmojis: (emojis: QuickReaction[]) => void;
};

export const useReactionPrefsStore = create<State>((set) => ({
  quickEmojis: DEFAULT_QUICK_EMOJIS,
  load: async () => {
    const stored = await getDevicePreference(QUICK_REACTIONS_KEY, QUICK_REACTIONS_KEY);
    if (!stored) return;
    try {
      const parsed = normalizeStoredQuickReactions(JSON.parse(stored));
      if (parsed) set({ quickEmojis: parsed });
    } catch {
      // Corrupt value — keep the default.
    }
  },
  setQuickEmojis: (emojis) => {
    set({ quickEmojis: emojis });
    void trySetDevicePreference(QUICK_REACTIONS_KEY, JSON.stringify(emojis));
  },
}));
