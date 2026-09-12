import type { CustomEmoji } from '@/lib/nostr/custom-emoji';

export type UploadedEmojiDraft = CustomEmoji;

type DraftRequest = {
  existingShortcodes: Set<string>;
  onComplete: (draft: UploadedEmojiDraft) => void;
};

const requests = new Map<string, DraftRequest>();
let nextRequestId = 0;

export function createEmojiDraftRequest(opts: {
  existingShortcodes: readonly string[];
  onComplete: (draft: UploadedEmojiDraft) => void;
}): string {
  nextRequestId += 1;
  const id = `${Date.now()}:${nextRequestId}`;
  requests.set(id, {
    existingShortcodes: new Set(
      opts.existingShortcodes.map((shortcode) => shortcode.toLowerCase()),
    ),
    onComplete: opts.onComplete,
  });
  return id;
}

export function hasEmojiDraftShortcode(
  requestId: string,
  shortcode: string,
): boolean {
  return (
    requests.get(requestId)?.existingShortcodes.has(shortcode.toLowerCase()) ?? false
  );
}

export function hasEmojiDraftRequest(requestId: string): boolean {
  return requests.has(requestId);
}

export function completeEmojiDraftRequest(
  requestId: string,
  draft: UploadedEmojiDraft,
): boolean {
  const request = requests.get(requestId);
  if (!request) return false;
  requests.delete(requestId);
  try {
    request.onComplete(draft);
    return true;
  } catch {
    return false;
  }
}

export function cancelEmojiDraftRequest(requestId: string): void {
  requests.delete(requestId);
}
