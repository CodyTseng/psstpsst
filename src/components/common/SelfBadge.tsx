import { VerifiedCheck as BadgeCheck } from '@solar-icons/react-native/category/money/Linear/VerifiedCheck';
import { useTranslation } from 'react-i18next';
import { View, type ViewStyle } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { radius, spacing, useThemeColors } from '@/theme';

// Registered optical exception: 4px is too tight after the label while 8px
// makes this compact inline badge visibly tail-heavy.
const TRAILING_INSET = 6;

/**
 * The "this is genuinely you" marker for the note-to-self conversation — an
 * `accent` pill with a check glyph and a short "You" label. **Anti-impersonation
 * is the whole point:** callers render it *only* when a pubkey equals the active
 * account's own key (a fact the app verifies), so a contact that copies your
 * name + avatar can never display it — their key differs.
 *
 * Sized to blend into a text line (caption + 2px vertical padding = 22px), like
 * `BlockedBadge`; pass `style` for placement.
 */
export function SelfBadge({ style }: { style?: ViewStyle }) {
  const { t } = useTranslation();
  const c = useThemeColors();
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'flex-start',
          gap: 4,
          paddingStart: spacing.xs,
          paddingEnd: TRAILING_INSET,
          paddingVertical: 2,
          borderRadius: radius.full,
          backgroundColor: c.accentSoft,
        },
        style,
      ]}
    >
      <BadgeCheck size={14} color={c.accent} />
      <AppText variant="caption" weight="semibold" style={{ color: c.accent }}>
        {t('common.you')}
      </AppText>
    </View>
  );
}
