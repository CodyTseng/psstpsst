import { Image, type ImageRef } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { ConversationMediaItem } from '@/hooks/use-conversation-media';
import { IS_ELECTRON } from '@/lib/platform';
import { getCachedAttachmentUri, getSessionCachedUri } from '@/services/files/file-attachment.service';
import { getCachedImageUri, getSessionImageUri } from '@/services/emoji/image-cache.service';

/** Reuse already resolved local paths before the next desktop frame paints. */
function getSessionUri(item: ConversationMediaItem): string | undefined {
  if (!IS_ELECTRON) return undefined;
  return (item.source === 'embedded'
    ? getSessionImageUri(item.meta.url)
    : getSessionCachedUri(item.meta)) ?? undefined;
}

/** Prepare only cached bytes in a bounded page window; never start a download. */
export function useCachedMediaImages(
  previous: ConversationMediaItem | undefined,
  current: ConversationMediaItem | undefined,
  next: ConversationMediaItem | undefined,
  previousOuter?: ConversationMediaItem,
  nextOuter?: ConversationMediaItem,
) {
  const window = useMemo(() => [current, previous, next, previousOuter, nextOuter].filter(
    (item): item is ConversationMediaItem => !!item && !item.isVideo,
  ), [previous, current, next, previousOuter, nextOuter]);
  const pending = useRef(new Map<string, Promise<ImageRef | string | null>>());
  useEffect(() => {
    const reads = pending.current;
    return () => { reads.clear(); };
  }, []);
  const [cache, setCache] = useState<{
    window: typeof window;
    images: ReadonlyMap<string, ImageRef | string | null>;
  }>(() => ({ window, images: new Map(window.flatMap((item) => {
    const uri = getSessionUri(item);
    return uri ? [[item.mediaKey, uri] as const] : [];
  })) }));
  if (cache.window !== window) {
    // Retain only successful decodes in the new window before it is painted.
    setCache({ window, images: new Map(window.flatMap((item) => {
      const image = cache.images.get(item.mediaKey) ?? getSessionUri(item);
      return image ? [[item.mediaKey, image] as const] : [];
    })) });
  }

  useEffect(() => {
    let cancelled = false;
    const keys = new Set(window.map((item) => item.mediaKey));
    for (const key of pending.current.keys()) {
      if (!keys.has(key)) pending.current.delete(key);
    }
    function publish(key: string, image: ImageRef | string | null) {
      if (!cancelled) setCache((existing) => existing.window === window
        ? { window, images: new Map(existing.images).set(key, image) } : existing);
    }
    for (const item of window) {
      if (cache.images.get(item.mediaKey)) continue;
      // A window shift must not restart reads/decodes for overlapping pages.
      let read = pending.current.get(item.mediaKey);
      if (!read) {
        read = (async () => {
          // Web has no native ImageRef cache API. Mounted neighbour surfaces
          // decode these local URIs ahead of selection and retain their DOM image.
          if (IS_ELECTRON) {
            return item.source === 'embedded'
              ? getCachedImageUri(item.meta.url)
              : getCachedAttachmentUri(item.meta);
          }
          if (item.source === 'embedded') {
            return Image.readFromCacheAsync(item.meta.sha256 ?? item.meta.url);
          }
          const uri = await getCachedAttachmentUri(item.meta);
          return uri && pending.current.get(item.mediaKey) === read ? Image.loadAsync(uri) : null;
        })().catch(() => null);
        const reads = pending.current;
        reads.set(item.mediaKey, read);
        void read.then(() => {
          if (reads.get(item.mediaKey) === read) reads.delete(item.mediaKey);
        });
      }
      void read.then((image) => { publish(item.mediaKey, image); });
    }
    return () => { cancelled = true; };
    // Successful decodes must not restart the window's other pending reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [window]);

  return cache.images;
}
