import { ShieldWarning as ShieldAlert } from '@solar-icons/react-native/category/security/Linear/ShieldWarning';
import { DangerTriangle as AlertTriangle } from '@solar-icons/react-native/category/ui/Linear/DangerTriangle';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AppText } from '@/components/common/AppText';
import { attachmentFailureCopy, type RevealAction } from '@/lib/attachments/failure';
import type { AttachmentErrorKind } from '@/services/files/file-attachment.service';
import { spacing, useThemeColors } from '@/theme';

/**
 * The failure stack for a **box-shaped** attachment bubble (image, video):
 * icon + reason + tap action, centered. Both operational and integrity failures
 * use the shared danger colour; integrity keeps its distinct shield glyph.
 * Purely presentational — the caller owns the Pressable and
 * its tap action (`revealOrRetry`). The reason/action copy comes from the one
 * shared {@link attachmentFailureCopy} vocabulary.
 */
export function AttachmentFailure({
  kind,
  action,
  iconSize = 20,
}: {
  kind: AttachmentErrorKind;
  action: RevealAction;
  iconSize?: number;
  tone?: 'neutral' | 'media';
}) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const copy = attachmentFailureCopy(kind, action);
  const failureColor = c.danger;

  return (
    <View style={{ alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm }}>
      {copy.integrity ? (
        <ShieldAlert size={iconSize} color={c.danger} />
      ) : (
        <AlertTriangle size={iconSize} color={failureColor} />
      )}
      <AppText
        variant="caption"
        tone="danger"
        align="center"
        style={{ color: failureColor }}
      >
        {t(copy.reasonKey)}
      </AppText>
      <AppText
        variant="caption"
        tone="danger"
        align="center"
        style={{ color: failureColor }}
      >
        {t(copy.actionKey)}
      </AppText>
    </View>
  );
}
