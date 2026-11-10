import type { AppAuthorization } from '@/services/app-authorization/model';
import { formatDateTime } from '@/lib/time';
import { useDateTimePreferences } from '@/stores/date-time.store';
import { isApplicationAction } from '@/services/signing/action-request';
import { useErrorToast } from '@/hooks/use-error-toast';
import { setFullyTrusted, updatePermissions } from '@/services/signing/management';
import { useState, type ReactNode } from 'react';
import { useIsFocused } from 'expo-router/react-navigation';
import { ActivityIndicator, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronUp from 'lucide-react-native/icons/chevron-up';
import { AppText } from '@/components/common/AppText';
import { AppButton } from '@/components/common/AppButton';
import { ListGroup } from '@/components/common/ListGroup';
import { ListRow } from '@/components/common/ListRow';
import { useNappletPermissions } from '@/hooks/use-napplet-permissions';
import { nappletService } from '@/services/napplet/service';
import type { NappletRelease } from '@/services/napplet/protocol';
import { signingAction } from './SigningRequestDetails';
import { spacing, useThemeColors } from '@/theme';
import { isSignerAccess, signingRuleKey, signingScope, type SigningActivity, type SigningScope, type SignerAccessOperation, type SigningRuleChange } from '@/services/signing/model';
import { DirectionalChevron } from '@/components/common/DirectionalChevron';
import { automaticallyAllowsSigning } from '@/services/app-authorization/policy';
import { Toggle } from '@/components/common/Toggle';
import { platform } from '@/platform';
import { showToast } from '@/stores/toast.store';
import { normalizeSigningSource } from '@/services/signing/source';
import { SigningRuleEditor, type EditableSigningRule } from './SigningRuleEditor';

/** Each focused account/source visit owns its editor state. */
export function NappletPermissions(props: { accountPubkey: string; release?: NappletRelease; sourceId?: string; initiallyExpanded?: boolean; access?: ReactNode | ((authorization?: AppAuthorization) => ReactNode) }) {
  const focused = useIsFocused();
  return focused ? <PermissionRules key={`${props.accountPubkey}:${props.release?.eventKey ?? props.sourceId}:${props.release?.hash}`} {...props} /> : null;
}

function PermissionRules({ accountPubkey, release, sourceId, initiallyExpanded = false, access }: { accountPubkey: string; release?: NappletRelease; sourceId?: string; initiallyExpanded?: boolean; access?: ReactNode | ((authorization?: AppAuthorization) => ReactNode) }) {
  const { t } = useTranslation();
  const dateTimeFormatPreferences = useDateTimePreferences();
  const c = useThemeColors();
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [history, setHistory] = useState(false);
  const { data, error } = useNappletPermissions(accountPubkey, release, expanded, sourceId);
  const [editor, setEditor] = useState<{ row: EditableSigningRule; visible: boolean; isNew?: boolean }>();
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<{ snapshot: typeof data; rows: EditableSigningRule[]; activity: NonNullable<typeof data>['activity'] }>(
    () => ({ snapshot: data, rows: data?.rules ?? [], activity: data?.activity ?? [] }),
  );
  if (data && !busy && view.snapshot !== data) {
    setView({ snapshot: data, rows: data.rules, activity: data.activity });
  }
  useErrorToast(expanded && error && 'applications.request_failed');
  const shown = data ?? view.snapshot;
  const rows = (data && !busy ? data.rules : view.rows);
  const activity = data?.activity ?? view.activity;
  async function save(row: EditableSigningRule, change: SigningRuleChange) {
    if (!accountPubkey || busy) throw new Error('session-closed');
    if (automaticallyAllowsSigning(shown?.authorization, row.scope)) throw new Error('permission-revoked');
    setBusy(true);
    const pending: EditableSigningRule = { ...row, decision: change.decision, duration: change.duration,
      expiresAt: change.duration === 'timed' ? change.expiresAt : undefined };
    setView((previous) => ({ ...previous, rows: rows.some(entry => entry.key === row.key)
      ? rows.map((entry) => entry.key === row.key ? pending : entry) : [...rows, pending] }));
    try { await (sourceId?updatePermissions({accountPubkey,sourceId},row,change):nappletService.updateSigningRule(release!, row, change, accountPubkey)); }
    catch (error) {
      setView((previous) => ({ ...previous, rows }));
      throw error;
    } finally { setBusy(false); }
  }
  function editActivity(entry: SigningActivity) {
    const scope = editableActivityScope(entry, shown?.authorization);
    if (!scope) return;
    const key = signingRuleKey(scope);
    const saved = rows.find(row => row.key === key);
    setEditor({ visible: true, isNew: !saved, row: saved ?? { key, scope,
      decision: 'ask', duration: 'always', createdAt: entry.at } });
  }
  async function changeTrust(fullyTrusted: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      if (!await platform.confirmationDialog.confirm({ title: t('applications.fully_trust'),
        message: t(fullyTrusted ? 'applications.fully_trust_enable_notice' : 'applications.fully_trust_disable_notice'),
        confirmLabel: t('common.save'), cancelLabel: t('common.cancel') })) return;
      const scope = { accountPubkey, sourceId: sourceId ?? normalizeSigningSource(release!.eventKey) };
      await setFullyTrusted(scope, fullyTrusted);
    } catch { showToast(t('applications.request_failed'), { variant: 'error' }); }
    finally { setBusy(false); }
  }
  return <View style={{ gap: spacing.lg }}>
    {expanded && shown?.authorization ? <ListGroup><ListRow title={t('applications.fully_trust')}
      subtitleMultiline subtitle={t(shown.authorization.fullyTrusted ? 'applications.fully_trust_on' : 'applications.fully_trust_off')}
      trailing={<Toggle value={shown.authorization.fullyTrusted} disabled={busy}
        accessibilityLabel={t('applications.fully_trust')} onValueChange={value => { void changeTrust(value); }} />} /></ListGroup> : null}
    {typeof access === 'function' ? access(shown?.authorization) : access}
    {!initiallyExpanded || !shown || rows.length || activity.length ? <View style={{ gap: spacing.md }}>
      {initiallyExpanded ? (!data || rows.length || activity.length ? <AppText variant="caption" tone="muted">{t('applications.permissions_signing')}</AppText> : null) :
        <AppButton variant="secondary" label={t('applications.signing_manage')} onPress={() => setExpanded(!expanded)} />}
      {expanded ? <>
        {!data && !error && !rows.length ? <ActivityIndicator color={c.accent} /> : null}
        {rows.length ? <ListGroup>{rows.map((rule) => {
          const status = rule.duration === 'timed' && rule.expiresAt
            ? t('applications.signing_until', { time: formatDateTime(rule.expiresAt / 1000, undefined, dateTimeFormatPreferences) })
            : t(rule.duration === 'session' ? 'applications.signing_session' : 'applications.signing_duration_always');
          const scope = [...(rule.scope.kind !== undefined && !isApplicationAction(rule.scope) ? [t('chat.event_reference.kind', { kind: rule.scope.kind })] : []), ...(rule.decision === 'ask' ? [] : [status])];
          if (rule.scope.scopeKey !== undefined) scope.push(`${rule.scope.kind !== undefined && rule.scope.kind >= 30000 && rule.scope.kind < 40000 ? 'd' : t('applications.signing_scope_key')}: ${JSON.stringify(rule.scope.scopeKey)}`);
          if (rule.scope.recipient) scope.push(`${t('applications.signing_recipient')}: ${rule.scope.recipient}`);
          if (rule.scope.relays.length) scope.push(rule.scope.relays.map(url => new URL(url).host).join(', '));
          return <ListRow key={rule.key} title={signingAction(rule.scope, t)} subtitleMultiline
            disabled={busy || !!shown?.authorization?.fullyTrusted} onPress={() => setEditor({ row: rule, visible: true })}
            titleTrailing={<DecisionStatus decision={rule.decision} />}
            subtitleContent={<View style={{ gap: spacing.xs }}>
              <AppText variant="caption" tone="muted">{scope.join(' · ')}</AppText>
            </View>}
            trailing={<DirectionalChevron size={spacing.lg} color={c.textMuted} />} />;
        })}</ListGroup> : null}
        {activity.length ? <>
          <ListGroup>
            <ListRow title={t('applications.signing_activity')} accessibilityRole="button"
              accessibilityState={{ expanded: history }}
              trailing={history ? <ChevronUp size={spacing.lg} color={c.textMuted} /> : <ChevronDown size={spacing.lg} color={c.textMuted} />}
              onPress={() => setHistory(!history)} />
            {history ? activity.map((entry, index) => <ListRow key={`${entry.at}:${index}`}
              onPress={editableActivityScope(entry, shown?.authorization) ? () => editActivity(entry) : undefined}
              trailing={editableActivityScope(entry, shown?.authorization) ? <DirectionalChevron size={spacing.lg} color={c.textMuted} /> : undefined}
              title={signingAction(entry.scope, t)}
              subtitle={`${t(`applications.signing_${entry.decision}`)} · ${formatDateTime(entry.at / 1000, undefined, dateTimeFormatPreferences)}`} />) : null}
          </ListGroup>
        </> : null}
      </> : null}
    </View> : null}
    {editor ? <SigningRuleEditor rule={editor.row} visible={editor.visible && !automaticallyAllowsSigning(shown?.authorization, editor.row.scope)} isNew={editor.isNew}
      onSave={(change) => save(editor.row, change)}
      onClose={() => setEditor((current) => current ? { ...current, visible: false } : undefined)}
      onClosed={() => setEditor(undefined)} /> : null}
  </View>;
}

function DecisionStatus({ decision }: { decision: SigningRuleChange['decision'] }) {
  const { t } = useTranslation();
  return <AppText variant="caption" weight="medium" tone={decision === 'ask' ? 'muted' : decision === 'allow' ? 'success' : 'danger'}>
    {t(decision === 'ask' ? 'applications.permissions_ask' : decision === 'allow' ? 'applications.allow' : 'applications.signing_reject')}
  </AppText>;
}

/** History omits record identifiers, so it cannot safely create addressable-record rules. */
function editableActivityScope(entry: SigningActivity, authorization?: AppAuthorization): SigningScope | undefined {
  let scope: SigningScope;
  if (isSignerAccess(entry.scope)) scope = { operation: entry.scope.operation, relays: [] };
  else {
    const kind = entry.scope.kind;
    if (kind === undefined || kind >= 30000 && kind < 40000) return undefined;
    scope = signingScope({ operation: entry.scope.operation as Exclude<SigningScope['operation'], SignerAccessOperation>, kind, relays: [] });
  }
  return automaticallyAllowsSigning(authorization, scope) ? undefined : scope;
}
