import { useEffect, useState } from 'react';

import { getVideoMetadata } from '@/services/files/video-poster.service';

/** Never accepts remote URLs or starts attachment downloads. */
export function useVideoPoster(localUri: string | null | undefined): string | undefined {
  const [poster, setPoster] = useState<{ source: string; uri: string } | null>(null);
  useEffect(() => {
    if (!localUri) return;
    const controller = new AbortController();
    void getVideoMetadata(localUri, { includeThumbhash: false, signal: controller.signal }).then((metadata) => {
      if (!controller.signal.aborted && metadata?.posterUri) setPoster({ source: localUri, uri: metadata.posterUri });
    }).catch(() => {});
    return () => controller.abort();
  }, [localUri]);
  return poster && poster.source === localUri ? poster.uri : undefined;
}
