import type { PeerRelationship } from '@/lib/chat/peer-relationship';
import type { FileAttachmentMeta } from '@/lib/nostr/file-tags';

export type RemoteContentMode = 'auto' | 'hold' | 'request';

export const MAX_AUTO_DOWNLOAD_BYTES = 20 * 1024 * 1024;

/** A declared plaintext or ciphertext size over 20 MiB requires explicit intent. */
export function attachmentExceedsAutoDownloadLimit(meta: FileAttachmentMeta): boolean {
  return [meta.plainSize, meta.size].some(
    (size) => typeof size === 'number' && size > MAX_AUTO_DOWNLOAD_BYTES,
  );
}

export type RemoteContentPolicy = {
  /** Recognize rich media from signed message metadata and URL extensions. */
  recognizeEmbeddedMedia: boolean;
  /** Allow a rendered media block to contact its remote URL. */
  loadRemoteMedia: boolean;
};

/**
 * Keep rich-message geometry independent from its loading policy. Transition
 * previews recognize media but hold remote bytes, while non-contact messages keep
 * remote URLs as ordinary links until the user opens them.
 */
export function remoteContentPolicy(mode: RemoteContentMode): RemoteContentPolicy {
  return {
    recognizeEmbeddedMedia: mode !== 'request',
    loadRemoteMedia: mode === 'auto',
  };
}

/** Conversation acceptance does not grant permission to load a stranger's URLs. */
export function conversationRemoteContentMode(
  loaded: boolean,
  relationship: PeerRelationship,
): RemoteContentMode {
  if (!loaded || relationship === 'unknown') return 'hold';
  return relationship === 'contact' ? 'auto' : 'request';
}

/** Own messages are trusted, but route previews must remain network-free. */
export function messageRemoteContentMode(
  mode: RemoteContentMode,
  isSelf: boolean,
): RemoteContentMode {
  return isSelf && mode !== 'hold' ? 'auto' : mode;
}
