import { isApplicationAction } from '@/services/signing/action-request';
import { useErrorToast } from '@/hooks/use-error-toast';
import { updatePermissions } from '@/services/signing/management';
import { useState } from 'react';
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
import type { SigningRule, SigningRuleChange } from '@/services/signing/model';
import { DirectionalChevron } from '@/components/common/DirectionalChevron';
import { SigningRuleEditor, type EditableSigningRule } from './SigningRuleEditor';

/** Cleared rows belong to this focused visit, never to persisted permissions. */
export function NappletPermissions(props: { accountPubkey: string; release?: NappletRelease; sourceId?: string; initiallyExpanded?: boolean }) {
  const focused = useIsFocused();
  return focused ? <PermissionRules key={`${props.accountPubkey}:${props.release?.eventKey ?? props.sourceId}:${props.release?.hash}`} {...props} /> : null;
}

function mergeRules(previous: EditableSigningRule[], saved: SigningRule[]): EditableSigningRule[] {
  const remaining = new Map(saved.map((rule) => [rule.key, rule]));
  const result: EditableSigningRule[] = [];
  for (const row of previous) {
    const current = remaining.get(row.key);
    if (current) result.push(current);
    else if (row.decision === 'ask') result.push(row);
    remaining.delete(row.key);
  }
  return [...result, ...remaining.values()];
}

function PermissionRules({ accountPubkey, release, sourceId, initiallyExpanded = false }: { accountPubkey: string; release?: NappletRelease; sourceId?: string; initiallyExpanded?: boolean }) {
  const { t, i18n } = useTranslation();
  const c = useThemeColors();
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [history, setHistory] = useState(false);
  const { data, error } = useNappletPermissions(accountPubkey, release, expanded, sourceId);
  const [editor, setEditor] = useState<{ row: EditableSigningRule; visible: boolean }>();
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<{ snapshot: typeof data; rows: EditableSigningRule[]; activity: NonNullable<typeof data>['activity'] }>(
    () => ({ snapshot: data, rows: data?.rules ?? [], activity: data?.activity ?? [] }),
  );
  if (data && !busy && view.snapshot !== data) {
    setView((previous) => ({ snapshot: data, rows: mergeRules(previous.rows, data.rules), activity: data.activity }));
  }
  useErrorToast(expanded && error && 'applications.request_failed');
  const rows = data && !busy ? mergeRules(view.rows, data.rules) : view.rows;
  const activity = data?.activity ?? view.activity;
  async function save(row: EditableSigningRule, change: SigningRuleChange) {
    if (!accountPubkey || busy) throw new Error('session-closed');
    setBusy(true);
    const pending: EditableSigningRule = { ...row, decision: change.decision, duration: change.duration,
      expiresAt: change.duration === 'timed' ? change.expiresAt : undefined };
    setView((previous) => ({ ...previous, rows: rows.map((entry) => entry.key === row.key ? pending : entry) }));
    try { await (sourceId?updatePermissions({accountPubkey,sourceId},row,change):nappletService.updateSigningRule(release!, row, change, accountPubkey)); }
    catch (error) {
      setView((previous) => ({ ...previous, rows: previous.rows.map((entry) => entry.key === row.key ? row : entry) }));
      throw error;
    } finally { setBusy(false); }
  }
  if (data && rows.length === 0 && activity.length === 0 && !editor) return null;
  return <View style={{ gap: spacing.md }}>
    {initiallyExpanded ? (!data || rows.length ? <AppText variant="subtitle">{t('applications.permissions_signing')}{data ? ` · ${rows.length}` : ''}</AppText> : null) :
      <AppButton variant="secondary" label={t('applications.signing_manage')} onPress={() => setExpanded(!expanded)} />}
    {expanded ? <>
      {rows.length ? <AppText variant="caption" tone="muted">{t('applications.permissions_hint')}</AppText> : null}
      {!data && !error && !rows.length ? <ActivityIndicator color={c.accent} /> : null}
      {rows.length ? <ListGroup>{rows.map((rule) => {
        const status = rule.duration === 'timed' && rule.expiresAt
          ? t('applications.signing_until', { time: new Date(rule.expiresAt).toLocaleString(i18n?.resolvedLanguage, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })
          : t(rule.duration === 'session' ? 'applications.signing_session' : 'applications.signing_duration_always');
        const scope = [...(rule.scope.kind !== undefined && !isApplicationAction(rule.scope) ? [t('chat.event_reference.kind', { kind: rule.scope.kind })] : []), ...(rule.decision === 'ask' ? [] : [status])];
        if (rule.scope.scopeKey !== undefined) scope.push(`${rule.scope.kind !== undefined && rule.scope.kind >= 30000 && rule.scope.kind < 40000 ? 'd' : t('applications.signing_scope_key')}: ${JSON.stringify(rule.scope.scopeKey)}`);
        if (rule.scope.recipient) scope.push(`${t('applications.signing_recipient')}: ${rule.scope.recipient}`);
        if (rule.scope.relays.length) scope.push(rule.scope.relays.map(url => new URL(url).host).join(', '));
        return <ListRow key={rule.key} title={signingAction(rule.scope, t)} subtitleMultiline
          disabled={busy} onPress={() => setEditor({ row: rule, visible: true })}
          titleTrailing={<DecisionStatus decision={rule.decision} />}
          subtitleContent={<View style={{ gap: spacing.xs }}>
            <AppText variant="caption" tone="muted">{scope.join(' · ')}</AppText>
          </View>}
          trailing={<DirectionalChevron size={spacing.lg} color={c.textMuted} />} />;
      })}</ListGroup> : null}
      {activity.length ? <>
        <AppButton variant="text" compact compactAxis="none" labelVariant="caption" label={t('applications.signing_activity')}
          accessibilityState={{ expanded: history }}
          iconRight={history ? <ChevronUp size={spacing.lg} color={c.text} /> : <ChevronDown size={spacing.lg} color={c.text} />}
          onPress={() => setHistory(!history)} />
        {history ? <ListGroup>{activity.map((entry, index) => <ListRow key={`${entry.at}:${index}`}
          title={signingAction(entry.scope, t)}
          subtitle={`${t(`applications.signing_${entry.decision}`)} · ${new Date(entry.at).toLocaleString(i18n?.resolvedLanguage)}`} />)}</ListGroup> : null}
      </> : null}
    </> : null}
    {editor ? <SigningRuleEditor rule={editor.row} visible={editor.visible}
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
