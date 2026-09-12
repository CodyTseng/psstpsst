import X from 'lucide-react-native/icons/x';
import { useEffect } from 'react';
import { ScrollView, View } from 'react-native';

import { InteractivePressable as Pressable } from '@/components/common/InteractivePressable';
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { AppText } from '@/components/common/AppText';
import { Avatar } from '@/components/common/Avatar';
import { SectionLabel } from '@/components/common/SectionLabel';
import { useContact } from '@/hooks/use-contacts';
import { useProfile } from '@/hooks/use-profile';
import { useLanguageDirection } from '@/i18n/direction';
import { resolveDisplayName } from '@/lib/nostr/display-name';
import { shareTargetId, type ShareTarget } from '@/lib/share/share-target';
import { useActiveAccount } from '@/stores/active-account.store';
import { iconStrokeWidth } from '@/theme/icons';
import { radius, spacing, uiDensity, useThemeColors } from '@/theme';

const AVATAR = uiDensity.selectedRecipientAvatarSize;
const CHIP_W = uiDensity.selectedRecipientWidth;
const SUMMARY_AVATAR = uiDensity.shareRecipientSummaryAvatarSize;

function useRecipientPresentation(target: ShareTarget) {
  const accountPubkey = useActiveAccount((state) => state.activePubkey) ?? '';
  const relayPubkey = target.deliveryKind === 'relay' ? target.conversationKey : null;
  const profile = useProfile(relayPubkey);
  const contact = useContact(accountPubkey, relayPubkey ?? '');
  const name =
    target.name ||
    resolveDisplayName(target.conversationKey, {
      petname: contact?.petname,
      displayName: profile?.displayName,
      name: profile?.name,
    });

  return {
    name,
    picture: target.deliveryKind === 'relay' ? profile?.picture : null,
  };
}

/** One chosen recipient — avatar + name with a remove badge; tap to deselect. */
function RecipientChip({ target, onRemove }: { target: ShareTarget; onRemove: (id: string) => void }) {
  const c = useThemeColors();
  const { name, picture } = useRecipientPresentation(target);
  const id = shareTargetId(target);
  return (
    <Pressable onPress={() => onRemove(id)} style={{ width: CHIP_W, alignItems: 'center', gap: 4 }}>
      <View>
        <Avatar
          pubkey={target.conversationKey}
          picture={picture}
          name={name}
          size={AVATAR}
        />
        {/* Remove badge — a dark dot with an × at the avatar's top-right. */}
        <View
          style={{
            position: 'absolute',
            top: -2,
            end: -2,
            width: 18,
            height: 18,
            borderRadius: radius.full,
            backgroundColor: c.text,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <X strokeWidth={iconStrokeWidth.compact} size={11} color={c.background} />
        </View>
      </View>
      <AppText variant="micro" numberOfLines={1} style={{ maxWidth: CHIP_W }}>
        {name}
      </AppText>
    </Pressable>
  );
}

function RecipientSummaryIdentity({ target }: { target: ShareTarget }) {
  const { name, picture } = useRecipientPresentation(target);

  return (
    <View
      accessible
      accessibilityLabel={name}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
      }}
    >
      <Avatar
        pubkey={target.conversationKey}
        picture={picture}
        name={name}
        size={SUMMARY_AVATAR}
      />
      <AppText variant="body" weight="medium" numberOfLines={1}>
        {name}
      </AppText>
    </View>
  );
}

/** Persistent recipient identity shown above a share confirmation preview. */
export function RecipientSummary({ label, targets }: { label: string; targets: ShareTarget[] }) {
  const direction = useLanguageDirection();

  return (
    <View
      style={{
        direction,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
      }}
    >
      <SectionLabel>{label}</SectionLabel>
      <ScrollView
        horizontal
        style={{ flex: 1 }}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: spacing.lg }}
      >
        {targets.map((target) => (
          <RecipientSummaryIdentity key={shareTargetId(target)} target={target} />
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * The chosen recipients in multi-select, as a horizontal **scrollable** avatar
 * row above the search box. Tap an avatar to drop it from the selection.
 *
 * Stays mounted in multi-select (even at zero) and **expands/collapses** with a
 * height + fade transition so it doesn't pop in/out and shove the search box.
 * The content height is **measured** (text scales with the OS font), and held
 * frozen while collapsing so removing the last chip doesn't snap the height down
 * before the animation.
 */
export function SelectedRecipientsRow({
  targets,
  onRemove,
}: {
  targets: ShareTarget[];
  onRemove: (id: string) => void;
}) {
  const shown = targets.length > 0;
  const progress = useSharedValue(0);
  // Last measured open height. Updated only while shown, so a collapse animates
  // from the full height (not the now-empty content's height).
  const contentH = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(shown ? 1 : 0, { duration: 200 });
  }, [shown, progress]);

  const wrapStyle = useAnimatedStyle(() => ({
    height: progress.value * contentH.value,
    opacity: progress.value,
  }));

  return (
    <Reanimated.View style={[{ overflow: 'hidden' }, wrapStyle]}>
      {/* Absolutely positioned so it always lays out at its natural (font-scaled)
          height — even while the wrapper is animated/clipped to 0 — so onLayout
          reports the real height to animate toward (an in-flow child would get
          squashed to the wrapper's 0 height and measure 0). */}
      <View
        style={{ position: 'absolute', left: 0, right: 0, top: 0 }}
        onLayout={(e) => {
          if (shown) contentH.value = e.nativeEvent.layout.height;
        }}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, gap: 16 }}
        >
          {targets.map((target) => (
            <RecipientChip key={shareTargetId(target)} target={target} onRemove={onRemove} />
          ))}
        </ScrollView>
      </View>
    </Reanimated.View>
  );
}
