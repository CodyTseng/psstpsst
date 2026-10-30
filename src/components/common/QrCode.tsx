import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, View } from 'react-native';
import QRCodeStyled, { type RenderCustomPieceItem } from 'react-native-qrcode-styled';
import { G, Rect } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';

import { IS_ELECTRON } from '@/lib/platform';
import { useThemeColors } from '@/theme';

// Session cache of rasterised QRs (`data|size|color|background` -> file uri).
// The code is deterministic, so once drawn we reuse a cheap <Image> on later opens instead
// of re-mounting ~600 SVG nodes — that mount is what stalls a sheet's slide-up,
// so caching keeps reopens instant and smooth.
const qrCache = new Map<string, string>();

type Props = {
  /** The string to encode (npub, nostrconnect:// URI, relay URL, …). */
  data: string;
  size: number;
  /** Module colour. Defaults to the global accent. */
  color?: string;
};

function finderOrigin(
  x: number,
  y: number,
  matrixSize: number,
): readonly [number, number] | null {
  const far = matrixSize - 7;
  if (x < 7 && y < 7) return [0, 0];
  if (x >= far && y < 7) return [far, 0];
  if (x < 7 && y >= far) return [0, far];
  return null;
}

/**
 * Telegram-style QR (rounded dots + eyes) for any string. On a cache miss it
 * defers the heavy SVG draw until the open animation settles, then rasterises
 * itself into a session cache; on a hit it renders the cached image immediately.
 * The caller provides a quiet zone using the global accent foreground.
 */
export function QrCode({ data, size, color }: Props) {
  const c = useThemeColors();
  const moduleColor = color ?? c.accent;
  const cacheKey = `${data}|${size}|${moduleColor}|${c.accentForeground}`;
  return (
    <QrCodeSurface
      key={cacheKey}
      data={data}
      size={size}
      color={moduleColor}
      backgroundColor={c.accentForeground}
      cacheKey={cacheKey}
    />
  );
}

/** A changed colour pair starts a fresh deferred draw instead of showing stale pixels. */
function QrCodeSurface({ data, size, color, backgroundColor, cacheKey: key }: {
  data: string;
  size: number;
  color: string;
  backgroundColor: string;
  cacheKey: string;
}) {
  const ref = useRef<View>(null);
  const [uri, setUri] = useState<string | null>(() => qrCache.get(key) ?? null);
  // On a cache miss, hold a blank tile until after the open animation so drawing
  // the SVG doesn't stall the slide-up.
  const [ready, setReady] = useState(false);
  const renderElectronPiece = useCallback<RenderCustomPieceItem>(
    ({ x, y, pieceSize, bitMatrix }) => {
      const eyeOrigin = finderOrigin(x, y, bitMatrix.length);
      if (eyeOrigin) {
        const [originX, originY] = eyeOrigin;
        if (x !== originX || y !== originY) return null;
        return (
          <G key={`eye:${originX}:${originY}`}>
            <Rect
              x={(originX + 0.5) * pieceSize}
              y={(originY + 0.5) * pieceSize}
              width={6 * pieceSize}
              height={6 * pieceSize}
              rx={1.5 * pieceSize}
              fill="none"
              stroke={color}
              strokeWidth={pieceSize}
            />
            <Rect
              x={(originX + 2) * pieceSize}
              y={(originY + 2) * pieceSize}
              width={3 * pieceSize}
              height={3 * pieceSize}
              rx={1.5 * pieceSize}
              fill={color}
            />
          </G>
        );
      }
      if (bitMatrix[y]?.[x] !== 1) return null;
      return (
        <Rect
          key={`piece:${x}:${y}`}
          x={x * pieceSize}
          y={y * pieceSize}
          width={pieceSize}
          height={pieceSize}
          rx={pieceSize / 2}
          fill={color}
        />
      );
    },
    [color],
  );

  useEffect(() => {
    if (uri) return;
    // Defer drawing the SVG until the JS thread is idle (after the open
    // animation), so it doesn't stall the slide-up. `requestIdleCallback`
    // replaces the deprecated `InteractionManager`; the timeout guarantees it
    // still fires if the thread stays busy.
    const handle = requestIdleCallback(() => setReady(true), { timeout: 500 });
    return () => cancelIdleCallback(handle);
  }, [uri]);

  // Once the SVG has painted, rasterise it into the cache for next time. We keep
  // showing the live SVG this mount; the cache only benefits subsequent opens.
  useEffect(() => {
    if (uri || !ready) return;
    let cancelled = false;
    const t = setTimeout(() => {
      if (qrCache.has(key)) return;
      captureRef(ref, { format: 'png', quality: 1 })
        .then((captured) => {
          if (!cancelled) qrCache.set(key, captured);
        })
        .catch(() => {});
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [ready, uri, key]);

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, backgroundColor }}
        fadeDuration={0}
        onError={() => {
          qrCache.delete(key);
          setUri(null);
        }}
      />
    );
  }

  if (!ready) return <View style={{ width: size, height: size, backgroundColor }} />;

  return (
    <View ref={ref} collapsable={false} style={{ width: size, height: size, backgroundColor }}>
      <QRCodeStyled
        data={data}
        size={size}
        padding={0}
        color={color}
        style={{ backgroundColor }}
        renderCustomPieceItem={IS_ELECTRON ? renderElectronPiece : undefined}
        {...(!IS_ELECTRON
          ? {
              pieceBorderRadius: '50%' as const,
              outerEyesOptions: { borderRadius: '25%' as const },
              innerEyesOptions: { borderRadius: '50%' as const },
            }
          : undefined)}
      />
    </View>
  );
}
