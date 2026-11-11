import { useEvent } from 'expo';
import { useVideoPlayer, type VideoPlayer, type VideoSource } from 'expo-video';
import { useEffect, useRef } from 'react';

import { IS_ELECTRON } from '@/lib/platform';

/** One selected surface owns loading and the initial playback request. */
export function useMediaVideoPlayer(source: VideoSource, onError: () => void) {
  // Web replaceAsync starts playback before React commits the new src prop.
  // Initialize with the source so that commit cannot interrupt a pending play.
  const player = useVideoPlayer(IS_ELECTRON ? source : null, (instance) => {
    instance.loop = false;
    instance.timeUpdateEventInterval = IS_ELECTRON ? 0 : 0.5;
  });
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  const autoplayedPlayer = useRef<VideoPlayer | null>(null);

  useEffect(() => {
    if (status === 'error') onError();
  }, [status, onError]);

  useEffect(() => {
    if (!IS_ELECTRON || status !== 'readyToPlay' || autoplayedPlayer.current === player) return;
    // Later buffer/readiness changes must preserve a user's pause decision.
    autoplayedPlayer.current = player;
    player.play();
  }, [player, status]);

  useEffect(() => {
    if (IS_ELECTRON) return;
    let cancelled = false;
    void player.replaceAsync(source).then(() => {
      if (!cancelled) player.play();
    }).catch(() => { if (!cancelled) onError(); });
    return () => {
      cancelled = true;
      // useVideoPlayer owns release; native cleanup runs before this one.
    };
  }, [player, source, onError]);

  return player;
}
