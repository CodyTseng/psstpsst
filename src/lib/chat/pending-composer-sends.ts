import type { CustomEmoji } from '@/lib/nostr/custom-emoji';

type Send = (text: string, customEmojis: CustomEmoji[]) => Promise<void> | void;

type PendingSend = {
  text: string;
  customEmojis: CustomEmoji[];
  resolve: () => void;
  reject: (error: unknown) => void;
};

/** Bridges the single render task before the full chat runtime mounts. Normal
 * sends keep their synchronous fast path; only sends without a handler queue. */
export class PendingComposerSends {
  private handler: Send | null = null;
  private pending: PendingSend[] = [];

  constructor(readonly scopeKey = '') {}

  send(text: string, customEmojis: CustomEmoji[]): Promise<void> | void {
    if (this.handler) return this.handler(text, customEmojis);
    return new Promise<void>((resolve, reject) => {
      this.pending.push({ text, customEmojis, resolve, reject });
    });
  }

  attach(handler: Send): void {
    this.handler = handler;
    const pending = this.pending;
    this.pending = [];
    for (const entry of pending) this.dispatch(handler, entry);
  }

  detach(handler: Send): void {
    if (this.handler === handler) this.handler = null;
  }

  cancel(error: Error): void {
    this.handler = null;
    const pending = this.pending;
    this.pending = [];
    for (const entry of pending) entry.reject(error);
  }

  private dispatch(handler: Send, entry: PendingSend): void {
    try {
      Promise.resolve(handler(entry.text, entry.customEmojis)).then(
        entry.resolve,
        entry.reject,
      );
    } catch (error) {
      entry.reject(error);
    }
  }
}
