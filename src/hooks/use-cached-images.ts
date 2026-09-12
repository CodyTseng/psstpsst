import { useEffect, useMemo, useState } from 'react';

import { downloadImage, getCachedImageUri, getSessionImageUri, isImageDownloading, subscribeImageCache } from '@/services/emoji/image-cache.service';

type CachedImage = { url: string; uri: string | null; checked: boolean; failed: boolean };

/** A bounded preview (one image or ten pack cells), never an entire collection. */
export function useCachedImages(urls: readonly string[], downloadAllowed: boolean, attempt = 0) {
  const key = JSON.stringify(urls);
  const initial = useMemo(() => {
    const entries = JSON.parse(key) as string[];
    return entries.map((url): CachedImage => {
      const uri = getSessionImageUri(url);
      return { url, uri, checked: !!uri, failed: false };
    });
  }, [key]);
  const [result, setResult] = useState({ key, images: initial });
  const images = result.key === key ? result.images : initial;

  useEffect(() => {
    let cancelled = false;
    function update(index: number, value: CachedImage) {
      if (cancelled) return;
      setResult((previous) => {
        const next = [...(previous.key === key ? previous.images : initial)];
        // A policy change never erases bytes that have already been resolved.
        const current = next[index];
        if (current.uri && !value.uri) return previous;
        if (previous.key === key && current.uri === value.uri &&
            current.checked === value.checked && current.failed === value.failed) return previous;
        next[index] = value;
        return { key, images: next };
      });
    }
    const unsubscribe = initial.map(({ url }, index) => subscribeImageCache(url, (uri) => {
      update(index, { url, uri, checked: true, failed: false });
    }));
    initial.forEach(({ url }, index) => {
      void (async () => {
        let uri: string | null = null;
        try {
          uri = await getCachedImageUri(url);
          if (cancelled) return;
          if (!uri && downloadAllowed) uri = await downloadImage(url);
          update(index, { url, uri, checked: true, failed: false });
        } catch {
          update(index, { url, uri, checked: true, failed: true });
        }
      })();
    });
    return () => { cancelled = true; unsubscribe.forEach((remove) => remove()); };
  }, [attempt, downloadAllowed, initial, key]);

  // A new policy render can occur before its effect joins an authorized fetch.
  // Do not briefly offer another download using an older cache-miss snapshot.
  return images.map((image) => !image.uri && isImageDownloading(image.url)
    ? { ...image, checked: false }
    : image);

}
