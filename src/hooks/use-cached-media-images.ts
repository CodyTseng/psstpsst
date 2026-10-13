import { Image, type ImageRef } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';

import type { ConversationMediaItem } from '@/hooks/use-conversation-media';
import { IS_ELECTRON } from '@/lib/platform';
import { platform } from '@/platform';
import { getCachedAttachmentUri } from '@/services/files/file-attachment.service';

/** Prepare only cached bytes in the three-page window; never start a download. */
export function useCachedMediaImages(
  previous: ConversationMediaItem | undefined,
  current: ConversationMediaItem | undefined,
  next: ConversationMediaItem | undefined,
) {
  const window = useMemo(() => [previous, current, next].filter(
    (item): item is ConversationMediaItem => !!item && !item.isVideo,
  ), [previous, current, next]);
  const [cache, setCache] = useState<{
    window: typeof window;
    images: ReadonlyMap<string, ImageRef | string | null>;
  }>(() => ({ window, images: new Map() }));
  if (cache.window !== window) {
    // Retain only successful decodes in the new window before it is painted.
    setCache({ window, images: new Map(window.flatMap((item) => {
      const image = cache.images.get(item.mediaKey);
      return image ? [[item.mediaKey, image] as const] : [];
    })) });
  }

  useEffect(() => {
    let cancelled = false;
    function publish(key: string, image: ImageRef | string | null) {
      if (!cancelled) setCache((existing) => existing.window === window
        ? { window, images: new Map(existing.images).set(key, image) } : existing);
    }
    for (const item of window) {
      if (cache.images.get(item.mediaKey)) continue;
      void (async () => {
        // Web has no native ImageRef cache API. Mounted neighbour surfaces
        // decode these local URIs ahead of selection and retain their DOM image.
        if (IS_ELECTRON) {
          const uri = item.source === 'embedded'
            ? await platform.imageCache.getCachedUri(item.meta.url)
            : await getCachedAttachmentUri(item.meta);
          publish(item.mediaKey, uri);
          return;
        }
        const image = item.source === 'embedded'
          ? await Image.readFromCacheAsync(item.meta.sha256 ?? item.meta.url)
          : await (async () => {
            const uri = await getCachedAttachmentUri(item.meta);
            return uri && !cancelled ? Image.loadAsync(uri) : null;
          })();
        publish(item.mediaKey, image);
      })().catch(() => {
        publish(item.mediaKey, null);
      });
    }
    return () => { cancelled = true; };
    // Successful decodes must not restart the window's other pending reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [window]);

  return cache.images;
}
