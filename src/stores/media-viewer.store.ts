import { create } from 'zustand';

/**
 * Drives the global full-screen media viewer (mounted once at the app root).
 *
 * Two modes, one overlay:
 * - **single** — a lone image URI (profile avatar / banner). Zoom, save, or dismiss.
 * - **conversation** — a swipeable pager over *all* indexed images/videos in a
 *   conversation, whether attachments or direct URLs. The viewer loads the list itself (via
 *   `useConversationMedia`) from `conversationKey`, opening on `focusMessageId`;
 *   carrying only the key + id (not the resolved list) keeps a tap on a chat
 *   bubble cheap — no per-bubble media query.
 *
 * Both modes funnel through here so there is a single zoom/dismiss/save UX.
 */
export type MediaViewerPreview = { uri: string; cacheKey?: string };

type SingleMode = { mode: 'single'; uri: string };
type ConversationMode = {
  mode: 'conversation';
  conversationKey: string;
  /** The tapped item — anchors the windowed query so the pager loads media
   * *around* it (and never the whole history), and opens focused on it. */
  focusMessageId: string;
  focusOrderAt: number;
  /** Distinguishes several media URLs carried by the same message. */
  focusUrl: string;
  /** Opened from the album grid (vs a chat bubble) — the pager then hides its
   * "open album" button, since that's where the user just came from. */
  fromGallery: boolean;
  preview?: MediaViewerPreview;
};
export type MediaViewerTarget = SingleMode | ConversationMode;

type ConversationParams = {
  conversationKey: string;
  focusMessageId: string;
  focusOrderAt: number;
  focusUrl: string;
  fromGallery?: boolean;
  preview?: MediaViewerPreview;
};

type State = {
  target: MediaViewerTarget | null;
  /** Each open starts fresh, even when reopening the same image during dismissal. */
  sessionId: number;
  open: (uri: string) => void;
  openConversation: (params: ConversationParams) => void;
  close: () => void;
};

export const useMediaViewerStore = create<State>((set) => ({
  target: null,
  sessionId: 0,
  open: (uri) => set((state) => ({ target: { mode: 'single', uri }, sessionId: state.sessionId + 1 })),
  openConversation: ({ conversationKey, focusMessageId, focusOrderAt, focusUrl, fromGallery, preview }) =>
    set((state) => ({
      sessionId: state.sessionId + 1,
      target: {
        mode: 'conversation',
        conversationKey,
        focusMessageId,
        focusOrderAt,
        focusUrl,
        fromGallery: !!fromGallery,
        preview,
      },
    })),
  close: () => set({ target: null }),
}));

/** Imperative helper for call sites that aren't React components. */
export const mediaViewer = {
  open: (uri: string) => useMediaViewerStore.getState().open(uri),
  openConversation: (params: ConversationParams) =>
    useMediaViewerStore.getState().openConversation(params),
  close: () => useMediaViewerStore.getState().close(),
};
