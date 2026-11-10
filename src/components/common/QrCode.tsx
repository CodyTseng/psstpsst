import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, View } from 'react-native';
import QRCodeStyled, { type RenderCustomPieceItem } from 'react-native-qrcode-styled';
import { G, Path, Rect } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';

import { IS_ELECTRON } from '@/lib/platform';
import { useThemeColors } from '@/theme';

// Session cache of rasterised QRs (`data|size|color|background` -> file uri).
// The code is deterministic, so once drawn we reuse a cheap <Image> on later opens instead
// of regenerating the QR matrix and SVG; caching keeps reopens instant and smooth.
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
      // The library visits every cell. Emit one group so a dense invitation
      // creates a constant number of SVG nodes instead of thousands of them.
      if (x !== 0 || y !== 0) return null;
      const dots: string[] = [];
      for (let row = 0; row < bitMatrix.length; row++) {
        for (let column = 0; column < bitMatrix.length; column++) {
          if (bitMatrix[row]?.[column] !== 1 || finderOrigin(column, row, bitMatrix.length)) continue;
          dots.push(`M${column + 0.5} ${row}a.5.5 0 1 1 0 1a.5.5 0 1 1 0-1Z`);
        }
      }
      const far = bitMatrix.length - 7;
      return (
        <G key="pieces" scale={pieceSize}>
          <Path d={dots.join('')} fill={color} />
          {[[0, 0], [far, 0], [0, far]].map(([originX, originY]) => (
            <G key={`eye:${originX}:${originY}`}>
              <Rect
                x={originX + 0.5}
                y={originY + 0.5}
                width={6}
                height={6}
                rx={1.5}
                fill="none"
                stroke={color}
                strokeWidth={1}
              />
              <Rect
                x={originX + 2}
                y={originY + 2}
                width={3}
                height={3}
                rx={1.5}
                fill={color}
              />
            </G>
          ))}
        </G>
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
