import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronUp from 'lucide-react-native/icons/chevron-up';
import { useTranslation } from 'react-i18next';
import { AppText } from '@/components/common/AppText';
import { AppButton } from '@/components/common/AppButton';
import { Avatar } from '@/components/common/Avatar';
import { IdentityListItem } from '@/components/common/IdentityListItem';
import { ListGroup } from '@/components/common/ListGroup';
import { SigningRequester } from './SigningRequestDetails';
import { ListRow } from '@/components/common/ListRow';
import { Toggle } from '@/components/common/Toggle';
import { useDisplayName } from '@/hooks/use-display-name';
import { nappletService } from '@/services/napplet/service';
import { NAP_DOMAINS, type NappletRelease } from '@/services/napplet/protocol';
import { spacing, useThemeColors } from '@/theme';
import { NappletIcon } from './NappletIcon';
import { NappletPermissions } from './NappletPermissions';

export type NappletPanelAction = 'share' | 'reload' | 'publisher';

export function NappletPanel({ release, page, accountPubkey, onAction }: {
  release: NappletRelease; page: 'about' | 'settings'; accountPubkey: string;
  onAction: (action: NappletPanelAction) => void;
}) {
  const { t } = useTranslation();
  const { name, profile } = useDisplayName(release.event.pubkey);
  return <View style={{ gap: spacing.lg }}>
    {page === 'about' ? <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
        <NappletIcon release={release} />
        <AppText variant="title" style={{ flex: 1 }}>{release.title}</AppText>
      </View>
      {release.description ? <AppText>{release.description}</AppText> : null}
      <AppText variant="caption" tone="muted">{t('napplets.publisher')}</AppText>
      <IdentityListItem leading={<Avatar pubkey={release.event.pubkey} picture={profile?.picture} />}
        title={name} onPress={() => onAction('publisher')} />
      <AppText variant="caption" tone="muted">{t('napplets.version')}: {release.hash}</AppText>
    </> : <>
      <SigningRequester app={release} />
      <NappletPermissions release={release} initiallyExpanded />
      <DomainPermissions release={release} accountPubkey={accountPubkey} />
    </>}
  </View>;
}

export function NappletPanelActions({ onAction }: { onAction: (action: 'share' | 'settings' | 'reload') => void }) {
  const { t } = useTranslation();
  return <View style={{ flexDirection: 'row', gap: spacing.sm }}>
    {(['share', 'settings', 'reload'] as const).map((action) => <View key={action} style={{ flex: 1 }}>
      <AppButton variant="secondary" label={t(action === 'share' ? 'share.title' : action === 'settings' ? 'settings.title' : 'napplets.runtime_reload')}
        labelVariant="caption" onPress={() => onAction(action)} />
    </View>)}
  </View>;
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
      <AppButton variant="text" labelVariant="caption" label={t('napplets.capabilities_required')}
        accessibilityState={{ expanded: showRequired }}
        iconRight={showRequired ? <ChevronUp size={spacing.lg} color={c.text} /> : <ChevronDown size={spacing.lg} color={c.text} />} onPress={() => setShowRequired(!showRequired)} />
      {showRequired ? <ListGroup>{required.filter((domain) => domain !== 'shell').map((domain) => <ListRow key={domain}
        title={t(`napplets.capability_${domain}`, { defaultValue: domain })}
        value={t('napplets.capabilities_required')} valueTone="muted" />)}</ListGroup> : null}
    </> : null}
    {failed ? <AppText tone="danger">{t('napplets.request_failed')}</AppText> : null}
  </View>;
}
