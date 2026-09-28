import { Image } from 'expo-image';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { useThemeColors } from '@/theme';

type Props = {
  pubkey: string;
  picture?: string | number | null;
  /** Kept for call-site compatibility; the generated avatar is pubkey-derived. */
  name?: string | null;
  size?: number;
};

const svgCache = new Map<string, string>();
const imageLoadedListeners = new Map<string, Set<() => void>>();
const MAX_CACHED_GRADIENTS = 512;
const MAX_SHARED_CACHE_RETRIES = 2;

function notifyImageLoaded(url: string) {
  imageLoadedListeners.get(url)?.forEach((listener) => listener());
}

function subscribeImageLoaded(url: string, listener: () => void) {
  let listeners = imageLoadedListeners.get(url);
  if (!listeners) {
    listeners = new Set();
    imageLoadedListeners.set(url, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) imageLoadedListeners.delete(url);
  };
}

/**
 * Deterministic gradient avatar derived from the pubkey hex.
 * Ported from jumble's generateImageByPubkey: the first 3 six-char chunks
 * become colors, the rest seed radial-gradient control points.
 */
function generateAvatarSvg(pubkey: string): string {
  const cached = svgCache.get(pubkey);
  if (cached) {
    svgCache.delete(pubkey);
    svgCache.set(pubkey, cached);
    return cached;
  }

  const paddedPubkey = pubkey.padEnd(2, '0');

  const colors: string[] = [];
  const controlPoints: string[] = [];
  for (let i = 0; i < 11; i++) {
    const part = paddedPubkey.slice(i * 6, (i + 1) * 6);
    if (i < 3) {
      colors.push(`#${part}`);
    } else {
      controlPoints.push(part);
    }
  }

  const gradients = controlPoints
    .map((point, index) => {
      const cx = parseInt(point.slice(0, 2), 16) % 100;
      const cy = parseInt(point.slice(2, 4), 16) % 100;
      const r = (parseInt(point.slice(4, 6), 16) % 35) + 30;
      const color = colors[index % (colors.length - 1)];
      // A truncated trailing chunk yields NaN; jumble paints nothing for it.
      if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(r)) {
        return '';
      }
      return `
        <radialGradient id="avatar-gradient-${index}" cx="${cx}%" cy="${cy}%" r="${r}%">
          <stop offset="0%" stop-color="${color}" stop-opacity="1" />
          <stop offset="100%" stop-color="${color}" stop-opacity="0" />
        </radialGradient>
        <rect width="100%" height="100%" fill="url(#avatar-gradient-${index})" />
      `;
    })
    .join('');

  const svg = `<svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${colors[2]}" fill-opacity="0.3" />${gradients}</svg>`;

  svgCache.set(pubkey, svg);
  if (svgCache.size > MAX_CACHED_GRADIENTS) {
    const oldest = svgCache.keys().next().value;
    if (oldest !== undefined) svgCache.delete(oldest);
  }
  return svg;
}

export function Avatar({ pubkey, picture, size = 44 }: Props) {
  const c = useThemeColors();
  const gradientId = `avatar-${useId().replace(/:/g, '')}`;
  const pictureUrl = typeof picture === 'string' ? picture : null;
  const currentPictureUrl = useRef(pictureUrl);
  const failedUrl = useRef<string | null>(null);
  const retryCount = useRef(0);
  const [retryRevision, setRetryRevision] = useState(0);
  const [failedPictureUrl, setFailedPictureUrl] = useState<string | null>(null);
  const showGradient = !picture || (!!pictureUrl && failedPictureUrl === pictureUrl);
  const imageSource = useMemo(
    () => (pictureUrl ? { uri: pictureUrl } : picture),
    [pictureUrl, picture],
  );

  useEffect(() => {
    currentPictureUrl.current = pictureUrl;
    failedUrl.current = null;
    retryCount.current = 0;
    if (!pictureUrl) return;
    return subscribeImageLoaded(pictureUrl, () => {
      // A different avatar can finish after this one has changed its picture.
      if (
        currentPictureUrl.current !== pictureUrl ||
        failedUrl.current !== pictureUrl ||
        retryCount.current >= MAX_SHARED_CACHE_RETRIES
      ) return;
      failedUrl.current = null;
      retryCount.current += 1;
      // Remount only the failed image view. The shared Expo cache now has the
      // bytes, while a previously failed native view does not reload itself.
      setRetryRevision((revision) => revision + 1);
    });
  }, [pictureUrl]);

  const svg = useMemo(() => {
    if (!showGradient || !/^[0-9a-f]{12,}$/i.test(pubkey)) return null;
    // Keep the cached artwork shared, but scope SVG references to this instance:
    // a hidden screen's duplicate IDs can suppress another avatar's gradients.
    return generateAvatarSvg(pubkey).replaceAll('avatar-gradient-', `${gradientId}-gradient-`);
  }, [pubkey, gradientId, showGradient]);

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: 'hidden',
        backgroundColor: c.surfaceMuted,
      }}
    >
      {svg ? <SvgXml xml={svg} width={size} height={size} /> : null}
      {picture ? (
        <Image
          key={`${pictureUrl ?? picture}:${retryRevision}`}
          source={imageSource}
          cachePolicy="memory-disk"
          recyclingKey={pictureUrl ?? undefined}
          transition={150}
          contentFit="cover"
          onError={() => {
            if (pictureUrl && currentPictureUrl.current === pictureUrl) {
              failedUrl.current = pictureUrl;
              setFailedPictureUrl(pictureUrl);
            }
          }}
          onLoad={() => {
            if (pictureUrl && currentPictureUrl.current === pictureUrl) {
              failedUrl.current = null;
              setFailedPictureUrl(null);
              notifyImageLoaded(pictureUrl);
            }
          }}
          style={{ position: 'absolute', width: size, height: size }}
        />
      ) : null}
    </View>
  );
}
