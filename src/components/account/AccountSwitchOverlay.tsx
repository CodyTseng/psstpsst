import { useEffect, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { Avatar } from '@/components/common/Avatar';
import { useProfile } from '@/hooks/use-profile';
import { resolveName } from '@/lib/nostr/display-name';
import { useActiveAccount } from '@/stores/active-account.store';
import { spacing, useThemeColors } from '@/theme';

const AVATAR_SIZE = 96;

/**
 * The account-switch transition — a full-screen overlay that **crossfades** over
 * the navigator while {@link useActiveAccount.setActive} swaps identities, rather
 * than the navigator hard-cutting to a separate screen. Driven by the store's
 * `switchingTo`: when it's set the overlay fades **in** over the (still-mounted)
 * outgoing screen and fronts the target account's avatar + name (not the app
 * logo); when the switch finishes (`switchingTo` cleared, after the store's
 * minimum hold) it fades **out**, revealing the incoming account's screen
 * beneath.
 *
 * The main inbox reuses a session-memory result when warm and otherwise keeps
 * the standard quiet placeholder until its async database query resolves. It
 * never performs a database read during render.
 *
 * It stays mounted at `opacity: 0` when idle (the account it would show is just
 * `switchingTo ?? activePubkey`, the *same* account all through the fade-out, so
 * no "remember the last target" state is needed).
 */
export function AccountSwitchOverlay() {
  const c = useThemeColors();
  const switchingTo = useActiveAccount((s) => s.switchingTo);
  const activePubkey = useActiveAccount((s) => s.activePubkey);
  const pubkey = switchingTo ?? activePubkey;
  const [fade] = useState(() => new Animated.Value(0)); // whole-overlay opacity
  const [enter] = useState(() => new Animated.Value(0)); // avatar ease-in
  const [pulse] = useState(() => new Animated.Value(0)); // slow breathe

  useEffect(() => {
    if (!switchingTo) {
      // Fade the overlay out over the now-revealed incoming screen.
      Animated.timing(fade, {
        toValue: 0,
        duration: 280,
        easing: Easing.in(Easing.quad),
        useNativeDriver: Platform.OS !== 'web',
      }).start();
      return;
    }
    enter.setValue(0);
    pulse.setValue(0);
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 240,
        easing: Easing.out(Easing.quad),
        useNativeDriver: Platform.OS !== 'web',
      }),
      Animated.timing(enter, {
        toValue: 1,
        duration: 440,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: Platform.OS !== 'web',
      }),
    ]).start();
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [switchingTo, fade, enter, pulse]);

  if (!pubkey) return null;

  return <Overlay pubkey={pubkey} fade={fade} enter={enter} pulse={pulse} bg={c.background} />;
}

function Overlay({
  pubkey,
  fade,
  enter,
  pulse,
  bg,
}: {
  pubkey: string;
  fade: Animated.Value;
  enter: Animated.Value;
  pulse: Animated.Value;
  bg: string;
}) {
  const profile = useProfile(pubkey);
  const name = resolveName(profile) ?? '';
  const scale = Animated.multiply(
    enter.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }),
    pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }),
  );

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { backgroundColor: bg, opacity: fade, zIndex: 50, pointerEvents: 'none' }]}
    >
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.lg,
          paddingHorizontal: 24,
        }}
      >
        <Animated.View style={{ opacity: enter, transform: [{ scale }] }}>
          <Avatar pubkey={pubkey} picture={profile?.picture} name={name} size={AVATAR_SIZE} />
        </Animated.View>
        {name ? (
          <Animated.View style={{ maxWidth: '100%', opacity: enter }}>
            <AppText variant="display" weight="bold" align="center" numberOfLines={1}>
              {name}
            </AppText>
          </Animated.View>
        ) : null}
      </View>
    </Animated.View>
  );
}
