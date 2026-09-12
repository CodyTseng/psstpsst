import { createStore } from 'zustand/vanilla';

export type AttachmentTransferSource = 'bluetooth' | 'network' | 'upload';

export type AttachmentTransferProgress = {
  source: AttachmentTransferSource;
  receivedBytes: number;
  totalBytes: number;
  percent: number;
};

type AttachmentTransferState = {
  byKey: Record<string, AttachmentTransferProgress>;
  update(
    key: string,
    source: AttachmentTransferSource,
    receivedBytes: number,
    totalBytes: number,
  ): void;
  clear(key: string): void;
};

export function attachmentTransferKey(accountPubkey: string, rumorId: string): string {
  return `${accountPubkey}:${rumorId}`;
}

export const attachmentTransferStore = createStore<AttachmentTransferState>()((set) => ({
  byKey: {},
  update: (key, source, receivedBytes, totalBytes) =>
    set((state) => {
      const boundedTotal = Math.max(0, totalBytes);
      const boundedReceived = Math.max(0, Math.min(receivedBytes, boundedTotal));
      const percent = boundedTotal > 0 ? Math.floor((boundedReceived / boundedTotal) * 100) : 0;
      const current = state.byKey[key];
      // One upload attempt may fall back across servers. Every new native PUT
      // reports from zero, but the user-facing aggregate must never move back.
      if (source === 'upload' && current?.source === 'upload' && percent < current.percent) {
        return state;
      }
      if (current?.source === source && current.percent === percent) return state;
      return {
        byKey: {
          ...state.byKey,
          [key]: {
            source,
            receivedBytes: boundedReceived,
            totalBytes: boundedTotal,
            percent,
          },
        },
      };
    }),
  clear: (key) =>
    set((state) => {
      if (!state.byKey[key]) return state;
      const byKey = { ...state.byKey };
      delete byKey[key];
      return { byKey };
    }),
}));
