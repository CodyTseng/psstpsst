import { create } from 'zustand';

import {
  DEFAULT_NOSTR_EVENT_URL,
  NOSTR_EVENT_URL_PREFERENCE_KEY,
  normalizeNostrEventUrl,
} from '@/lib/nostr/event-url';
import {
  getDevicePreference,
  trySetDevicePreference,
} from '@/services/preferences/device-preferences.service';

/** Device-level chat preferences (not per-account), kept in SQLite beside
 * the other non-secret device preferences. */
const ENTER_TO_SEND_KEY = 'chat.enterToSend';

type State = {
  /** When true, Enter/return sends the message. A line break uses Shift+Enter
   * on desktop or a long-press on Send for touch. Default false: Enter inserts
   * a newline and the send button sends (the mobile-messenger norm). */
  enterToSend: boolean;
  nostrEventUrl: string;
  load: () => Promise<void>;
  setEnterToSend: (value: boolean) => void;
  setNostrEventUrl: (value: string) => void;
};

export const useChatPrefsStore = create<State>((set) => ({
  enterToSend: false,
  nostrEventUrl: DEFAULT_NOSTR_EVENT_URL,
  load: async () => {
    const [stored, storedUrl] = await Promise.all([
      getDevicePreference(ENTER_TO_SEND_KEY, ENTER_TO_SEND_KEY),
      getDevicePreference(NOSTR_EVENT_URL_PREFERENCE_KEY),
    ]);
    set({
      enterToSend: stored === 'true',
      nostrEventUrl: normalizeNostrEventUrl(storedUrl ?? '') ?? DEFAULT_NOSTR_EVENT_URL,
    });
  },
  setEnterToSend: (value) => {
    // Optimistic: flip state immediately so the switch is instant, then persist.
    set({ enterToSend: value });
    void trySetDevicePreference(ENTER_TO_SEND_KEY, value ? 'true' : 'false');
  },
  setNostrEventUrl: (value) => {
    const normalized = normalizeNostrEventUrl(value);
    if (normalized == null) return;
    set({ nostrEventUrl: normalized });
    void trySetDevicePreference(NOSTR_EVENT_URL_PREFERENCE_KEY, normalized);
  },
}));
