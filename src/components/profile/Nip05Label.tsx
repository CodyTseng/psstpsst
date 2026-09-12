import { VerifiedCheck as BadgeCheck } from '@solar-icons/react-native/category/money/Linear/VerifiedCheck';
import CircleQuestionMark from 'lucide-react-native/icons/circle-question-mark';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { queryNip05Profile } from '@/lib/nostr/nip05';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing, useThemeColors } from '@/theme';

type Status = 'pending' | 'verified' | 'failed';

const BADGE_SIZE = 14;

/** Memoize results for the session so we verify each (nip05, pubkey) pair once. */
const cache = new Map<string, boolean>();

/**
 * Renders a NIP-05 identifier with a verification badge: it resolves
 * `domain/.well-known/nostr.json?name=…` and checks the returned pubkey matches
 * the profile's. Verified uses an accent check badge; failed/unreachable uses
 * a muted question mark of the same size. Used on both the user's own and others' profiles.
 */
export function Nip05Label({ nip05, pubkey }: { nip05: string; pubkey: string }) {
  const c = useThemeColors();
  const cacheKey = `${nip05.toLowerCase()}|${pubkey}`;
  const [status, setStatus] = useState<Status>(() =>
    cache.has(cacheKey) ? (cache.get(cacheKey) ? 'verified' : 'failed') : 'pending',
  );

  useEffect(() => {
    if (cache.has(cacheKey)) {
      setStatus(cache.get(cacheKey) ? 'verified' : 'failed');
      return;
    }
    let active = true;
    setStatus('pending');
    void (async () => {
      let ok = false;
      try {
        const res = await queryNip05Profile(nip05);
        ok = res?.pubkey === pubkey.toLowerCase();
      } catch {
        ok = false;
      }
      cache.set(cacheKey, ok);
      if (active) setStatus(ok ? 'verified' : 'failed');
    })();
    return () => {
      active = false;
    };
  }, [cacheKey, nip05, pubkey]);

  // Display as `@local ⟨badge⟩ domain` — the badge stands in for the inner `@`.
  // Verified tints the badge + domain blue (accent); otherwise they stay grey.
  // `_@domain` (no meaningful local part) shows just `⟨badge⟩ domain`.
  const at = nip05.indexOf('@');
  const local = at >= 0 ? nip05.slice(0, at) : '';
  const domain = at >= 0 ? nip05.slice(at + 1) : nip05;
  const showLocal = !!local && local !== '_';

  const verified = status === 'verified';
  const accentColor = verified ? c.accent : c.textMuted;
  const Badge = status === 'failed' ? CircleQuestionMark : BadgeCheck;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        flexShrink: 1,
        minWidth: 0,
      }}
    >
      {showLocal ? (
        <AppText
          variant="body"
          tone="muted"
          numberOfLines={1}
          ellipsizeMode="tail"
          style={{ flexShrink: 1, minWidth: 0 }}
        >
          @{local}
        </AppText>
      ) : null}
      <View
        style={{
          flexShrink: 0,
          width: BADGE_SIZE,
          height: BADGE_SIZE,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Badge size={BADGE_SIZE} color={accentColor} strokeWidth={iconStrokeWidth.default} />
      </View>
      <AppText
        variant="body"
        numberOfLines={1}
        ellipsizeMode="tail"
        style={{ color: accentColor, flexShrink: 1, minWidth: 0 }}
      >
        {domain}
      </AppText>
    </View>
  );
}
