import { formatDateTime } from '@/lib/time';
import { useDateTimePreferences } from '@/stores/date-time.store';
import { useErrorToast } from '@/hooks/use-error-toast';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppText } from '@/components/common/AppText';
import { ListGroup } from '@/components/common/ListGroup';
import { ListRow } from '@/components/common/ListRow';
import { DirectionalChevron } from '@/components/common/DirectionalChevron';
import { useBrowserPermissions } from '@/hooks/use-browser-permissions';
import { clearBrowserPermissions, saveBrowserPermissions, type BrowserPermissionRule } from '@/services/explore/browser-permission-store';
import { browserPermissionLabel, WALLET_INFO_PERMISSION } from '@/services/explore/browser-permissions';
import { automaticallyAllowsWalletInfo } from '@/services/app-authorization/policy';
import { PermissionRuleEditor } from './SigningRuleEditor';
import { spacing, useThemeColors } from '@/theme';

export function BrowserPermissions({ accountPubkey, sourceId }: { accountPubkey: string; sourceId: string }) {
  const { t } = useTranslation();
  const dateTimeFormatPreferences = useDateTimePreferences();
  const c = useThemeColors();
  const data = useBrowserPermissions(accountPubkey, sourceId);
  useErrorToast(data?.error && 'applications.request_failed');
  const [editor, setEditor] = useState<{ rule: BrowserPermissionRule; visible: boolean }>();
  const walletInfoCovered = automaticallyAllowsWalletInfo(data?.authorization);
  const rules = data?.rules;
  const sections = [
    { key: 'wallet', title: t('wallet.title'), rules: rules?.filter(rule => rule.resource === WALLET_INFO_PERMISSION) ?? [] },
    { key: 'browser', title: t('applications.browser_permission'), rules: rules?.filter(rule => rule.resource !== WALLET_INFO_PERMISSION) ?? [] },
  ];
  const editorCovered = editor?.rule.resource === WALLET_INFO_PERMISSION && walletInfoCovered;
  if (editorCovered) setEditor(undefined);
  if (data && !data.error && !rules?.length && (!editor || editorCovered)) return null;
  return <View style={{ gap: spacing.lg }}>
    {!data ? <ActivityIndicator color={c.accent} /> : null}
    {sections.filter(section => section.rules.length > 0).map(section => <View key={section.key} style={{ gap: spacing.md }}>
      <AppText variant="caption" tone="muted">{section.title}</AppText>
      <ListGroup>{section.rules.map(rule =>
        <ListRow key={rule.resource} title={browserPermissionLabel(rule.resource, t)}
          subtitle={rule.expiresAt === null ? t('applications.signing_duration_always') : t('applications.signing_until', {
            time: formatDateTime(rule.expiresAt / 1000, undefined, dateTimeFormatPreferences),
          })}
          titleTrailing={<AppText variant="caption" tone={rule.decision === 'allow' ? 'success' : 'danger'}>{t(rule.decision === 'allow' ? 'applications.allow' : 'applications.signing_reject')}</AppText>}
          trailing={<DirectionalChevron size={spacing.lg} color={c.textMuted} />}
          disabled={rule.resource === WALLET_INFO_PERMISSION && walletInfoCovered}
          onPress={() => setEditor({ rule, visible: true })} />)}</ListGroup>
    </View>)}
    {editor && !editorCovered ? <PermissionRuleEditor key={editor.rule.resource} title={browserPermissionLabel(editor.rule.resource, t)} visible={editor.visible}
      rule={{ decision: editor.rule.decision, duration: editor.rule.expiresAt === null ? 'always' : 'timed', expiresAt: editor.rule.expiresAt ?? undefined }}
      onSave={async change => {
        if (!accountPubkey) throw new Error('account-unavailable');
        if (editor.rule.resource === WALLET_INFO_PERMISSION && walletInfoCovered) throw new Error('permission-revoked');
        const scope = { accountPubkey, sourceId };
        if (change.decision === 'ask') await clearBrowserPermissions(scope, editor.rule.resource);
        else await saveBrowserPermissions(scope, [editor.rule.resource], change.decision, change.duration === 'timed' ? change.expiresAt! : null);
      }}
      onClose={() => setEditor(current => current ? { ...current, visible: false } : undefined)} onClosed={() => setEditor(undefined)} /> : null}
  </View>;
}
