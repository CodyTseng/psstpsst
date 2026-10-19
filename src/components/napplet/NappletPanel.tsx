import { useEffect, useState } from 'react';
import RotateCw from 'lucide-react-native/icons/rotate-cw';
import Copy from 'lucide-react-native/icons/copy';
import Check from 'lucide-react-native/icons/check';
import { useClipboard } from '@/hooks/use-clipboard';
import { Share } from '@solar-icons/react-native/category/ui/Linear/Share';
import { ShieldCheck } from '@solar-icons/react-native/category/security/Linear/ShieldCheck';
import { useTranslation } from 'react-i18next';
import { HorizontalFadeScrollView } from '@/components/common/HorizontalFadeScrollView';
import { ProfileAction } from '@/components/profile/ProfileAction';
import { nappletService } from '@/services/napplet/service';
import { NAP_DOMAINS, type NappletRelease } from '@/services/napplet/protocol';
import { spacing, uiDensity, useThemeColors } from '@/theme';
import { iconStrokeWidth } from '@/theme/icons';
import { ApplicationPanel } from './ApplicationPanel';
import { ApplicationSettings } from './ApplicationSettings';
import { ApplicationAccessControls } from './ApplicationAccessControls';
import { applicationPresentation } from '@/services/explore/model';

export type NappletPanelAction = 'share' | 'reload' | 'publisher';

export function NappletPanel({ release, page, accountPubkey, onAction }: {
  release: NappletRelease; page: 'about' | 'settings'; accountPubkey: string;
  onAction: (action: NappletPanelAction) => void;
}) {
  return <ApplicationPanel application={applicationPresentation(release)} page={page}
    onPublisher={()=>onAction('publisher')} settings={<NappletSettings release={release} accountPubkey={accountPubkey}/>}/>;
}

export function NappletSettings({ release, accountPubkey }: { release: NappletRelease; accountPubkey: string }) {
  return <ApplicationSettings release={release}
    access={release.required.some(domain=>domain!=='shell')||release.optional.length?<DomainPermissions release={release} accountPubkey={accountPubkey}/>:undefined}
    onReset={()=>nappletService.revoke(release,accountPubkey)}/>;
}

export function NappletPanelActions({ address, onAction }: { address: string; onAction: (action: 'share' | 'settings' | 'reload') => void }) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const { copyText, copied } = useClipboard();
  const actions = [
    { key: 'copy', label: t(copied ? 'common.copied' : 'napplets.copy_address'), icon: copied
      ? <Check size={spacing.xl} color={c.text} strokeWidth={iconStrokeWidth.default}/>
      : <Copy size={spacing.xl} color={c.text} strokeWidth={iconStrokeWidth.default}/> },
    { key: 'share', label: t('share.title'), icon: <Share size={spacing.xl} color={c.text} /> },
    { key: 'settings', label: t('napplets.permissions_manage'), icon: <ShieldCheck size={spacing.xl} color={c.text} /> },
    { key: 'reload', label: t('napplets.runtime_reload'), icon: <RotateCw size={spacing.xl} color={c.text} strokeWidth={iconStrokeWidth.default} /> },
  ] as const;
  return <HorizontalFadeScrollView fadeColor={c.sheetBackground}
    contentContainerStyle={{ gap: spacing.xs, alignItems: 'flex-start' }}>
    {actions.map((action) => <ProfileAction key={action.key} shape="square" layout="fixed"
      width={uiDensity.profileActionWidth + spacing.lg} size={uiDensity.profileActionSize + spacing.lg}
      singleLineLabel icon={action.icon} label={action.label} accessibilityLabel={action.label}
      onPress={() => { if (action.key === 'copy') void copyText(address); else onAction(action.key); }} />)}
  </HorizontalFadeScrollView>;
}

function DomainPermissions({ release, accountPubkey }: { release: NappletRelease; accountPubkey: string }) {
  const [saved, setSaved] = useState<string[]>();
  const [selected, setSelected] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
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
  return <ApplicationAccessControls required={required} optional={optional} selected={saved?selected:undefined}
    failed={failed} busy={busy} changed={!!changed}
    onToggle={(domain,enabled)=>setSelected(current=>enabled?[...current,domain]:current.filter(entry=>entry!==domain))}
    onSave={()=>{void save();}}/>;
}
