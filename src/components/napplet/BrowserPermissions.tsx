import { useErrorToast } from '@/hooks/use-error-toast';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppText } from '@/components/common/AppText';
import { ListGroup } from '@/components/common/ListGroup';
import { ListRow } from '@/components/common/ListRow';
import { DirectionalChevron } from '@/components/common/DirectionalChevron';
import { useBrowserPermissions } from '@/hooks/use-browser-permissions';
import { useNappletAccountPubkey } from '@/stores/napplet.store';
import { clearBrowserPermissions, saveBrowserPermissions, type BrowserPermissionRule } from '@/services/explore/browser-permission-store';
import { browserPermissionLabel } from '@/services/explore/browser-permissions';
import { PermissionRuleEditor } from './SigningRuleEditor';
import { spacing, useThemeColors } from '@/theme';

export function BrowserPermissions({ sourceId }: { sourceId: string }) {
  const { t, i18n } = useTranslation();
  const c = useThemeColors();
  const accountPubkey = useNappletAccountPubkey();
  const data = useBrowserPermissions(accountPubkey, sourceId);
  useErrorToast(data?.error && 'napplets.request_failed');
  const [editor, setEditor] = useState<{ rule: BrowserPermissionRule; visible: boolean }>();
  if (data && !data.error && !data.rules?.length && !editor) return null;
  return <View style={{ gap: spacing.md }}>
    <AppText variant="subtitle">{t('napplets.browser_permission')}{data?.rules ? ` · ${data.rules.length}` : ''}</AppText>
    {!data ? <ActivityIndicator color={c.accent} /> : data.error ? null
      : !data.rules?.length ? null : <ListGroup>{data.rules.map(rule =>
        <ListRow key={rule.resource} title={browserPermissionLabel(rule.resource, t)}
          subtitle={rule.expiresAt === null ? t('napplets.signing_duration_always') : t('napplets.signing_until', {
            time: new Date(rule.expiresAt).toLocaleString(i18n.resolvedLanguage, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
          })}
          titleTrailing={<AppText variant="caption" tone={rule.decision === 'allow' ? 'success' : 'danger'}>{t(rule.decision === 'allow' ? 'napplets.allow' : 'napplets.signing_reject')}</AppText>}
          trailing={<DirectionalChevron size={spacing.lg} color={c.textMuted} />}
          onPress={() => setEditor({ rule, visible: true })} />)}</ListGroup>}
    {editor ? <PermissionRuleEditor key={editor.rule.resource} title={browserPermissionLabel(editor.rule.resource, t)} visible={editor.visible}
      rule={{ decision: editor.rule.decision, duration: editor.rule.expiresAt === null ? 'always' : 'timed', expiresAt: editor.rule.expiresAt ?? undefined }}
      onSave={async change => {
        if (!accountPubkey) throw new Error('account-unavailable');
        const scope = { accountPubkey, sourceId };
        if (change.decision === 'ask') await clearBrowserPermissions(scope, editor.rule.resource);
        else await saveBrowserPermissions(scope, [editor.rule.resource], change.decision, change.duration === 'timed' ? change.expiresAt! : null);
      }}
      onClose={() => setEditor(current => current ? { ...current, visible: false } : undefined)} onClosed={() => setEditor(undefined)} /> : null}
  </View>;
}
