import { ForbiddenCircle as Ban } from '@solar-icons/react-native/category/ui/Linear/ForbiddenCircle';
import { useTranslation } from 'react-i18next';
import { View, type ViewStyle } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { radius, useThemeColors } from '@/theme';

/**
 * The one "Blocked" marker, used everywhere a blocked user surfaces (conversation
 * list, contacts list, peer profile): a `dangerSoft` pill with a `Ban` glyph and
 * the "Blocked" label in `danger`. Hugs its content (`flex-start`) so it never
 * stretches; pass `style` for placement (e.g. `marginTop`, `alignSelf`).
 *
 * Sized to **blend into a text line, not grow it**: caption text (18 line) + 2px
 * vertical padding = 22px tall — equal to a `body` preview line and under a
 * `subtitle` name line, so dropping it onto either row never changes the height.
 */
export function BlockedBadge({ style }: { style?: ViewStyle }) {
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
          paddingHorizontal: 8,
          paddingVertical: 2,
          borderRadius: radius.full,
          backgroundColor: c.dangerSoft,
        },
        style,
      ]}
    >
      <Ban size={13} color={c.danger} />
      <AppText variant="caption" weight="semibold" style={{ color: c.danger }}>
        {t('conversations.blocked')}
      </AppText>
    </View>
  );
}
