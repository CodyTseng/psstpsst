import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronUp from 'lucide-react-native/icons/chevron-up';
import { AppText } from '@/components/common/AppText';
import { AppButton } from '@/components/common/AppButton';
import { ListGroup } from '@/components/common/ListGroup';
import { ListRow } from '@/components/common/ListRow';
import { useNappletPermissions } from '@/hooks/use-napplet-permissions';
import { useDisplayName } from '@/hooks/use-display-name';
import { nappletService } from '@/services/napplet/service';
import type { NappletRelease } from '@/services/napplet/protocol';
import { signingAction } from './SigningRequestDetails';
import { spacing, useThemeColors } from '@/theme';

export function NappletPermissions({ release, initiallyExpanded = false }: { release: NappletRelease; initiallyExpanded?: boolean }) {
  const { t, i18n } = useTranslation();
  const c = useThemeColors();
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [history, setHistory] = useState(false);
  const { data, error, accountPubkey } = useNappletPermissions(release, expanded);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  function revoke(key: string) {
    if (!accountPubkey) return;
    setBusy(true); setFailed(false);
    void nappletService.revokeSigningRule(release, key, accountPubkey)
      .catch(() => setFailed(true)).finally(() => setBusy(false));
  }
  return <View style={{ gap: spacing.md }}>
    {initiallyExpanded ? <AppText variant="subtitle">{t('napplets.permissions_signing')}</AppText> :
      <AppButton variant="secondary" label={t('napplets.signing_manage')} onPress={() => setExpanded(!expanded)} />}
    {expanded ? <>
      <AppText variant="caption" tone="muted">{t('napplets.permissions_hint')}</AppText>
      {error || failed ? <AppText tone="danger">{t('napplets.request_failed')}</AppText> : null}
      {!data && !error ? <ActivityIndicator color={c.accent} /> : null}
      {data?.rules.length === 0 ? <AppText tone="muted">{t('napplets.signing_no_rules')}</AppText> : null}
      {data?.rules.length ? <ListGroup>{data.rules.map((rule) => {
        const decision = t(rule.decision === 'allow' ? 'napplets.allow' : 'napplets.signing_denied');
        const status = rule.duration === 'timed' && rule.expiresAt
          ? `${decision} · ${t('napplets.signing_until', { time: new Date(rule.expiresAt).toLocaleString(i18n?.resolvedLanguage, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })}`
          : rule.duration === 'session' ? `${decision} · ${t('napplets.signing_session')}`
          : t(rule.decision === 'allow' ? 'napplets.permissions_allow' : 'napplets.permissions_deny');
        const scope = [t('chat.event_reference.kind', { kind: rule.scope.kind }), status];
        if (rule.scope.identifier !== undefined) scope.push(`d: ${JSON.stringify(rule.scope.identifier)}`);
        if (rule.scope.operation === 'relay-auth') scope.push(...rule.scope.relays);
        return <ListRow key={rule.key} title={signingAction(rule.scope, t)} subtitle={scope.join('\n')}
          subtitleMultiline valuePlacement="below"
          belowValue={rule.scope.recipient ? <Recipient pubkey={rule.scope.recipient} /> : undefined}
          trailing={<AppButton variant="text" labelVariant="caption" label={t('napplets.permissions_revoke')}
            disabled={busy} onPress={() => revoke(rule.key)} />} />;
      })}</ListGroup> : null}
      {data?.activity.length ? <>
        <AppButton variant="text" labelVariant="caption" label={t('napplets.signing_activity')}
          accessibilityState={{ expanded: history }}
          iconRight={history ? <ChevronUp size={spacing.lg} color={c.text} /> : <ChevronDown size={spacing.lg} color={c.text} />}
          onPress={() => setHistory(!history)} />
        {history ? <ListGroup>{data.activity.map((entry, index) => <ListRow key={`${entry.at}:${index}`}
          title={signingAction(entry.scope, t)}
          subtitle={`${t(`napplets.signing_${entry.decision}`)} · ${new Date(entry.at).toLocaleString(i18n?.resolvedLanguage)}`} />)}</ListGroup> : null}
      </> : null}
    </> : null}
  </View>;
}

function Recipient({ pubkey }: { pubkey: string }) {
  const { t } = useTranslation();
  const { name } = useDisplayName(pubkey);
  return <AppText variant="caption" tone="muted">{t('napplets.signing_recipient')}: {name}</AppText>;
}
