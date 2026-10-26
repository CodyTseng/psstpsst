import { useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from '@/components/common/BottomSheet';
import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import { ListGroup } from '@/components/common/ListGroup';
import { ListRow } from '@/components/common/ListRow';
import { RadioIndicator } from '@/components/common/radio-indicator';
import { DirectionalChevron } from '@/components/common/DirectionalChevron';
import { ContextMenuOverlay, type ContextMenuAnchor } from '@/components/common/ContextMenu';
import { SIGNING_PERIODS, type SigningRule, type SigningRuleChange } from '@/services/signing/model';
import { IS_ELECTRON } from '@/lib/platform';
import { spacing, useThemeColors } from '@/theme';
import { signingAction, SigningScopeDetails } from './SigningRequestDetails';

export type EditableSigningRule = Omit<SigningRule, 'decision'> & { decision: SigningRuleChange['decision'] };

export function SigningRuleEditor({ rule, visible, onSave, onClose, onClosed }: {
  rule: EditableSigningRule; visible: boolean;
  onSave(change: SigningRuleChange): Promise<void>; onClose(): void; onClosed(): void;
}) {
  const { t } = useTranslation();
  return <PermissionRuleEditor rule={rule} title={signingAction(rule.scope, t)} visible={visible} onSave={onSave} onClose={onClose} onClosed={onClosed}>
    {rule.scope.kind !== undefined ? <AppText variant="caption" tone="muted">{t('chat.event_reference.kind', { kind: rule.scope.kind })}</AppText> : null}
    {rule.scope.operation === 'relay-auth' || rule.scope.scopeKey !== undefined || rule.scope.recipient || rule.scope.relays.length ? <SigningScopeDetails scope={rule.scope} /> : null}
  </PermissionRuleEditor>;
}

export function PermissionRuleEditor({ rule, title, visible, onSave, onClose, onClosed, children }: {
  rule: Pick<EditableSigningRule, 'decision' | 'duration' | 'expiresAt'>; title: string; visible: boolean; children?: ReactNode;
  onSave(change: SigningRuleChange): Promise<void>; onClose(): void; onClosed(): void;
}) {
  const { t, i18n } = useTranslation();
  const c = useThemeColors();
  const [decision, setDecision] = useState(rule.decision);
  const [period, setPeriod] = useState<'keep' | 'always' | keyof typeof SIGNING_PERIODS>('keep');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [anchor, setAnchor] = useState<ContextMenuAnchor>();
  const durationRef = useRef<View>(null);
  const expires = rule.duration === 'timed' && rule.expiresAt ? t('napplets.signing_until', {
    time: new Date(rule.expiresAt).toLocaleString(i18n?.resolvedLanguage, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
  }) : t(rule.duration === 'session' ? 'napplets.signing_session' : 'napplets.signing_duration_always');
  const options = [
    ...(rule.duration !== 'always' && rule.decision !== 'ask' ? [{ key: 'keep' as const, title: expires }] : []),
    ...(['10m', '1h', '24h'] as const).map((key) => ({ key, title: t(`napplets.signing_period_${key}`) })),
    { key: 'always' as const, title: t('napplets.signing_duration_always') },
  ];
  const selected = period === 'keep' && (rule.duration === 'always' || rule.decision === 'ask') ? 'always' : period;
  const changed = decision !== rule.decision || period !== 'keep';
  async function save() {
    if (busy) return;
    setBusy(true); setError(false);
    const change: SigningRuleChange = decision === 'ask' ? { decision, duration: 'always' } : period === 'keep'
      ? { decision, duration: rule.duration, expiresAt: rule.expiresAt }
      : period === 'always' ? { decision, duration: 'always' }
      : { decision, duration: 'timed', expiresAt: Date.now() + SIGNING_PERIODS[period] };
    try { await onSave(change); onClose(); }
    catch { setError(true); }
    finally { setBusy(false); }
  }
  function close() { if (anchor) setAnchor(undefined); else if (!busy) onClose(); }
  return <BottomSheet visible={visible} title={title} onClose={close} onClosed={onClosed}
    contentStyle={{ gap: spacing.lg }}
    fixedFooter={<AppButton label={t('common.save')} disabled={!changed} loading={busy} onPress={() => { void save(); }} />}
    modalOverlay={anchor ? <ContextMenuOverlay anchor={anchor} placement="above" align="end"
      density={IS_ELECTRON ? 'pointer' : 'touch'} onClose={() => setAnchor(undefined)}
      items={options.map((option) => ({ ...option, selected: option.key === selected,
        icon: <RadioIndicator selected={option.key === selected} />,
        onPress: () => { setPeriod(option.key); setAnchor(undefined); },
      }))} /> : undefined}>
    {children}
    <ListGroup>{(['ask', 'allow', 'deny'] as const).map((value) => <ListRow key={value}
      title={t(value === 'ask' ? 'napplets.permissions_ask' : value === 'allow' ? 'napplets.permissions_allow' : 'napplets.permissions_deny')}
      selectionMode="single" active={decision === value} disabled={busy}
      trailing={<RadioIndicator selected={decision === value} />} onPress={() => setDecision(value)} />)}</ListGroup>
    <View ref={durationRef} collapsable={false}>
      <ListRow title={t('napplets.permissions_duration')} disabled={busy || decision === 'ask'}
        value={decision === 'ask' ? t('napplets.none') : options.find((option) => option.key === selected)?.title ?? expires}
        trailing={<DirectionalChevron size={spacing.lg} color={c.textMuted} />}
        onPress={() => durationRef.current?.measureInWindow((x, y, width, height) => setAnchor({ x: x + width, y: y + height }))} />
    </View>

    {error ? <AppText tone="danger">{t('napplets.request_failed')}</AppText> : null}
  </BottomSheet>;
}
