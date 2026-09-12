import { Image } from 'expo-image';
import { useId, useMemo } from 'react';
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

/**
 * Deterministic gradient avatar derived from the pubkey hex.
 * Ported from jumble's generateImageByPubkey: the first 3 six-char chunks
 * become colors, the rest seed radial-gradient control points.
 */
function generateAvatarSvg(pubkey: string): string {
  const cached = svgCache.get(pubkey);
  if (cached) return cached;

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
  return svg;
}

export function Avatar({ pubkey, picture, size = 44 }: Props) {
  const c = useThemeColors();
  const gradientId = `avatar-${useId().replace(/:/g, '')}`;
  const svg = useMemo(() => {
    if (picture || !/^[0-9a-f]{12,}$/i.test(pubkey)) return null;
    // Keep the cached artwork shared, but scope SVG references to this instance:
    // a hidden screen's duplicate IDs can suppress another avatar's gradients.
    return generateAvatarSvg(pubkey).replaceAll('avatar-gradient-', `${gradientId}-gradient-`);
  }, [pubkey, picture, gradientId]);

  if (picture) {
    return (
      <Image
        source={typeof picture === 'string' ? { uri: picture } : picture}
        // expo-image keeps a global, URL-keyed memory+disk cache, so an avatar
        // loaded on one screen stays instant everywhere — unlike RN's Image,
        // which leans on the OS HTTP cache and re-fetches on each remount.
        cachePolicy="memory-disk"
        recyclingKey={typeof picture === 'string' ? picture : undefined}
        transition={150}
        contentFit="cover"
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.surfaceMuted }}
      />
    );
  }

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
    </View>
  );
}
