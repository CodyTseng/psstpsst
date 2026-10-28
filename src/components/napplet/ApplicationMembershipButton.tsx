import { useRef, useState } from 'react';
import Plus from 'lucide-react-native/icons/plus';
import Trash from 'lucide-react-native/icons/trash-2';
import { useTranslation } from 'react-i18next';
import { AppButton } from '@/components/common/AppButton';
import { iconStrokeWidth, spacing, useThemeColors } from '@/theme';

type Props = { added: boolean | undefined; onChange(added: boolean): void | Promise<void> };

/** A visible membership action adds or removes an app without launching it. */
export function ApplicationMembershipButton({ added, onChange }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const Icon = added ? Trash : Plus;
  return <AppButton variant={added ? 'danger' : 'secondary'} size="sm" fullWidth={false} labelVariant="body"
    label={t(added === undefined ? 'napplets.my_apps' : added ? 'napplets.remove_app' : 'napplets.add_app')}
    disabled={busy || added === undefined} loading={busy || added === undefined}
    iconLeft={added === undefined ? undefined : <Icon size={spacing.lg} color={added ? colors.danger : colors.text} strokeWidth={iconStrokeWidth.default} />}
    onLongPress={event => event.stopPropagation()}
    onPress={async event => {
      event.stopPropagation();
      if (added === undefined || pending.current) return;
      pending.current = true;
      setBusy(true);
      try { await onChange(!added); }
      finally { pending.current = false; setBusy(false); }
    }} />;
}
