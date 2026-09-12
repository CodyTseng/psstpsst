import { create } from 'zustand';

import { IS_DEVELOPMENT_BUILD } from '@/lib/environment';
import { platform } from '@/platform';

type State = {
  enabled: boolean;
  readConversationIds: Record<string, true>;
  readUnreadCount: number;
  timelineAnchorMs: number;
  markConversationRead: (conversationId: string, unreadCount: number) => void;
  setEnabled: (enabled: boolean) => void;
};

/** Session-only mode for composing promotional screenshots with fixture data. */
export const useScreenshotPreviewStore = create<State>((set) => ({
  enabled: false,
  readConversationIds: {},
  readUnreadCount: 0,
  timelineAnchorMs: Date.now(),
  markConversationRead: (conversationId, unreadCount) =>
    set((state) => {
      if (!state.enabled || state.readConversationIds[conversationId]) return state;
      return {
        readConversationIds: {
          ...state.readConversationIds,
          [conversationId]: true,
        },
        readUnreadCount: state.readUnreadCount + unreadCount,
      };
    }),
  setEnabled: (enabled) => {
    const nextEnabled = IS_DEVELOPMENT_BUILD && enabled;
    void platform.windowChrome.setScreenshotPreview(nextEnabled);
    set({
      enabled: nextEnabled,
      readConversationIds: {},
      readUnreadCount: 0,
      timelineAnchorMs: Date.now(),
    });
  },
}));
