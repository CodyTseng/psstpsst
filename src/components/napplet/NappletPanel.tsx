import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronUp from 'lucide-react-native/icons/chevron-up';
import RotateCw from 'lucide-react-native/icons/rotate-cw';
import { Share } from '@solar-icons/react-native/category/ui/Linear/Share';
import { ShieldCheck } from '@solar-icons/react-native/category/security/Linear/ShieldCheck';
import { useTranslation } from 'react-i18next';
import { AppText } from '@/components/common/AppText';
import { AppButton } from '@/components/common/AppButton';
import { ListGroup } from '@/components/common/ListGroup';
import { HorizontalFadeScrollView } from '@/components/common/HorizontalFadeScrollView';
import { ProfileAction } from '@/components/profile/ProfileAction';
import { SigningRequester } from './SigningRequestDetails';
import { ListRow } from '@/components/common/ListRow';
import { Toggle } from '@/components/common/Toggle';
import { nappletService } from '@/services/napplet/service';
import { NAP_DOMAINS, type NappletRelease } from '@/services/napplet/protocol';
import { spacing, uiDensity, useThemeColors } from '@/theme';
import { iconStrokeWidth } from '@/theme/icons';
import { NappletSummary } from './NappletSummary';
import { NappletPermissions } from './NappletPermissions';
import { platform } from '@/platform';

export type NappletPanelAction = 'share' | 'reload' | 'publisher';

export function NappletPanel({ release, page, accountPubkey, onAction }: {
  release: NappletRelease; page: 'about' | 'settings'; accountPubkey: string;
  onAction: (action: NappletPanelAction) => void;
}) {
  return <View style={{ gap: spacing.lg, paddingTop: page === 'about' ? spacing.md : 0 }}>
    {page === 'about' ? <NappletSummary release={release} onPublisher={() => onAction('publisher')} /> : <>
      <SigningRequester app={release} />
      <NappletSettings release={release} accountPubkey={accountPubkey} />
    </>}
  </View>;
}

export function NappletSettings({ release, accountPubkey }: { release: NappletRelease; accountPubkey: string }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [reset, setReset] = useState(0);
  async function resetPermissions() {
    if (busy) return;
    setBusy(true); setError(false);
    try {
      if (!await platform.confirmationDialog.confirm({ title: t('napplets.revoke'), message: t('napplets.revoke_notice'),
        confirmLabel: t('napplets.revoke'), cancelLabel: t('common.cancel'), destructive: true })) return;
      await nappletService.revoke(release, accountPubkey);
      setReset((value) => value + 1);
    } catch { setError(true); }
    finally { setBusy(false); }
  }
  return <View style={{ gap: spacing.xl }}>
    <NappletPermissions key={`signing:${reset}`} release={release} initiallyExpanded />
    <DomainPermissions key={`domains:${reset}`} release={release} accountPubkey={accountPubkey} />
    <AppButton variant="danger" label={t('napplets.revoke')} loading={busy} onPress={() => { void resetPermissions(); }} />
    {error ? <AppText tone="danger">{t('napplets.request_failed')}</AppText> : null}
  </View>;
}

export function NappletPanelActions({ onAction }: { onAction: (action: 'share' | 'settings' | 'reload') => void }) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const actions = [
    { key: 'share', label: t('share.title'), icon: <Share size={spacing.xl} color={c.text} /> },
    { key: 'settings', label: t('napplets.permissions_manage'), icon: <ShieldCheck size={spacing.xl} color={c.text} /> },
    { key: 'reload', label: t('napplets.runtime_reload'), icon: <RotateCw size={spacing.xl} color={c.text} strokeWidth={iconStrokeWidth.default} /> },
  ] as const;
  return <HorizontalFadeScrollView fadeColor={c.sheetBackground}
    contentContainerStyle={{ gap: spacing.xs, alignItems: 'flex-start' }}>
    {actions.map((action) => <ProfileAction key={action.key} shape="square" layout="fixed"
      width={uiDensity.profileActionWidth + spacing.lg} size={uiDensity.profileActionSize + spacing.lg}
      singleLineLabel icon={action.icon} label={action.label}
      onPress={() => onAction(action.key)} />)}
  </HorizontalFadeScrollView>;
}

function DomainPermissions({ release, accountPubkey }: { release: NappletRelease; accountPubkey: string }) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const [saved, setSaved] = useState<string[]>();
  const [selected, setSelected] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showRequired, setShowRequired] = useState(false);
  const required = [...new Set(['shell', ...release.required])];
  const optional = release.optional.filter((domain) => !required.includes(domain) && (NAP_DOMAINS as readonly string[]).includes(domain));
  useEffect(() => {
    let active = true;
    void nappletService.domainPermissions(release, accountPubkey).then((domains) => {
      if (active) {
        const selected = [...new Set(['shell', ...release.required, ...domains])];
        setSaved(selected); setSelected(selected);
      }
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [release, accountPubkey]);
  const changed = saved && (saved.length !== selected.length || saved.some((domain) => !selected.includes(domain)));
  async function save() {
    setBusy(true); setFailed(false);
    try {
      await nappletService.setDomainPermissions(release, selected, accountPubkey);
      setSaved(selected);
    } catch { setFailed(true); }
    finally { setBusy(false); }
  }
  return <View style={{ gap: spacing.md }}>
    <AppText variant="subtitle">{t('napplets.permissions_access')}</AppText>
    <AppText variant="caption" tone="muted">{t('napplets.permissions_access_hint')}</AppText>
    {!saved && !failed ? <ActivityIndicator color={c.accent} /> : null}
    {saved && optional.length ? <>
      <ListGroup>{optional.map((domain) => <ListRow key={domain} title={t(`napplets.capability_${domain}`, { defaultValue: domain })}
        trailing={<Toggle value={selected.includes(domain)} disabled={busy}
          onValueChange={(value) => setSelected((current) => value ? [...current, domain] : current.filter((entry) => entry !== domain))} />} />)}</ListGroup>
      {changed ? <AppButton label={t('napplets.permissions_save')} loading={busy} onPress={() => { void save(); }} /> : null}
    </> : null}
    {required.some((domain) => domain !== 'shell') ? <>
      <AppButton variant="text" compact compactAxis="none" labelVariant="caption" label={t('napplets.capabilities_required')}
        accessibilityState={{ expanded: showRequired }}
        iconRight={showRequired ? <ChevronUp size={spacing.lg} color={c.text} /> : <ChevronDown size={spacing.lg} color={c.text} />} onPress={() => setShowRequired(!showRequired)} />
      {showRequired ? <ListGroup>{required.filter((domain) => domain !== 'shell').map((domain) => <ListRow key={domain}
        title={t(`napplets.capability_${domain}`, { defaultValue: domain })}
        value={t('napplets.capabilities_required')} valueTone="muted" />)}</ListGroup> : null}
    </> : null}
    {failed ? <AppText tone="danger">{t('napplets.request_failed')}</AppText> : null}
  </View>;
}
