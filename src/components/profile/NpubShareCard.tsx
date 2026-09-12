import { forwardRef } from 'react';
import { View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { abbreviateNpub } from '@/lib/nostr/format';
import { radius, useThemeColors } from '@/theme';

import { NpubQrCode } from './NpubQrCode';

// The QR tile must stay white in any theme for scanner contrast (functional, not
// theming) — mirrors the functional colors inside NpubQrCode.
const QR_TILE = '#FFFFFF';
const QR_SIZE = 216;

type Props = {
  npub: string;
  /** Public identity only (never a private petname). */
  name?: string | null;
  nip05?: string | null;
};

/**
 * PsstPsst's "scan to add me" card. Borrows the balanced proportions of a good QR
 * card — a snug accent panel framing a white QR tile, identity stacked below —
 * but in PsstPsst's own colors and fields (accent-blue dotted QR, both nip-05 and
 * npub shown). No avatar/wordmark, so the card stays close to square instead of a
 * tall column. The rounded preview wrapper sits outside the forwarded capture
 * ref, so exported images have square outer corners while preserving the
 * rounded QR tile. The captured View stays non-collapsible for view-shot.
 */
export const NpubShareCard = forwardRef<View, Props>(function NpubShareCard(
  { npub, name, nip05 },
  ref,
) {
  const c = useThemeColors();
  return (
    <View style={{ borderRadius: radius['2xl'], overflow: 'hidden' }}>
      <View
        ref={ref}
        collapsable={false}
        style={{
          backgroundColor: c.accent,
          padding: 18,
          alignItems: 'center',
        }}
      >
        <View style={{ backgroundColor: QR_TILE, borderRadius: radius.xl, padding: 18 }}>
          <NpubQrCode npub={npub} size={QR_SIZE} color={c.accent} />
        </View>

        <View style={{ marginTop: 16, alignItems: 'center', gap: 3, paddingBottom: 2 }}>
          {name ? (
            <AppText
              variant="title"
              weight="bold"
              align="center"
              style={{ color: c.accentForeground, maxWidth: 248 }}
            >
              {name}
            </AppText>
          ) : null}
          {nip05 ? (
            <AppText
              variant="body"
              align="center"
              style={{ color: c.accentForeground, opacity: 0.85, maxWidth: 248 }}
            >
              {nip05}
            </AppText>
          ) : null}
          <AppText variant="caption" align="center" style={{ color: c.accentForeground, opacity: 0.7 }}>
            {abbreviateNpub(npub)}
          </AppText>
        </View>
      </View>
    </View>
  );
});
