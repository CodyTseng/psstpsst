import { forwardRef } from 'react';
import { View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { abbreviateNpub } from '@/lib/nostr/format';
import { radius, spacing, useThemeColors } from '@/theme';

import { NpubQrCode } from './NpubQrCode';

const QR_SIZE = 216;

type Props = {
  npub: string;
  /** Public identity only (never a private petname). */
  name?: string | null;
  nip05?: string | null;
};

/**
 * PsstPsst's "scan to add me" card. Borrows the balanced proportions of a good QR
 * card — a snug accent panel framing a contrasting QR tile, identity stacked below —
 * but in PsstPsst's own colors and fields (accent-coloured dotted QR, both nip-05 and
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
          padding: spacing.lg,
          alignItems: 'center',
        }}
      >
        <View style={{ backgroundColor: c.accentForeground, borderRadius: radius.xl, padding: spacing.lg }}>
          <NpubQrCode npub={npub} size={QR_SIZE} color={c.accent} />
        </View>

        <View style={{ marginTop: spacing.lg, alignItems: 'center', gap: spacing.xs }}>
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
              style={{ color: c.accentForegroundMuted, maxWidth: 248 }}
            >
              {nip05}
            </AppText>
          ) : null}
          <AppText variant="caption" align="center" style={{ color: c.accentForegroundMuted }}>
            {abbreviateNpub(npub)}
          </AppText>
        </View>
      </View>
    </View>
  );
});
