import { nappletAccessDomains } from '@/services/napplet/access-domains';
import { useEffect, useState } from 'react';
import { Global } from '@solar-icons/react-native/category/map/Linear/Global';
import RotateCw from 'lucide-react-native/icons/rotate-cw';
import Copy from 'lucide-react-native/icons/copy';
import Check from 'lucide-react-native/icons/check';
import Plus from 'lucide-react-native/icons/plus';
import Trash from 'lucide-react-native/icons/trash-2';
import { useApplicationFavorite } from '@/hooks/use-application-favorite';
import { getExploreState, useExplore } from '@/stores/explore.store';
import { exploreService } from '@/services/explore/service';
import { showToast } from '@/stores/toast.store';
import type { ExploreEntry } from '@/services/explore/model';
import { useClipboard } from '@/hooks/use-clipboard';
import { Share } from '@solar-icons/react-native/category/ui/Linear/Share';
import { ShieldCheck } from '@solar-icons/react-native/category/security/Linear/ShieldCheck';
import { useTranslation } from 'react-i18next';
import { HorizontalScrollView } from '@/components/common/HorizontalScrollView';
import { ProfileAction } from '@/components/profile/ProfileAction';
import { nappletService } from '@/services/napplet/service';
import { NAP_DOMAINS, type NappletRelease } from '@/services/napplet/protocol';
import { spacing, uiDensity, useThemeColors } from '@/theme';
import { iconStrokeWidth } from '@/theme/icons';
import { ApplicationPanel } from './ApplicationPanel';
import { ApplicationSettings } from './ApplicationSettings';
import { ApplicationAccessControls } from './ApplicationAccessControls';
import { applicationCopyAddress, applicationPresentation } from '@/services/explore/model';

export type NappletPanelAction = 'share' | 'reload' | 'publisher';

export function NappletPanel({ release, page, accountPubkey, onAction }: {
  release: NappletRelease; page: 'about' | 'settings'; accountPubkey: string;
  onAction: (action: NappletPanelAction) => void;
}) {
  return <ApplicationPanel application={applicationPresentation(release)} page={page}
    onPublisher={()=>onAction('publisher')} settings={<NappletSettings release={release} accountPubkey={accountPubkey}/>}/>;
}

export function NappletSettings({ release, accountPubkey }: { release: NappletRelease; accountPubkey: string }) {
  return <ApplicationSettings accountPubkey={accountPubkey} release={release}
    access={nappletAccessDomains([...release.required,...release.optional]).some(domain=>domain!=='shell')?<DomainPermissions release={release} accountPubkey={accountPubkey}/>:undefined}
    onReset={()=>nappletService.revoke(release,accountPubkey)}/>;
}

export function NappletPanelActions({ entry, account, onAction, onOpenExternal }: { entry: ExploreEntry; account: string | null; onAction: (action: 'share' | 'settings' | 'reload') => void; onOpenExternal?: () => void }) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const { copyText, copied } = useClipboard();
  const state = useExplore();
  const favorite = state.account === account && state.entries.some(app => app.key === entry.key && app.desktopPosition !== null);
  const setFavorite = useApplicationFavorite(account, 'detail');
  useEffect(() => {
    if (!account) return;
    const current = getExploreState();
    if (current.account !== account || !current.loaded)
      void exploreService.activate(account).catch(() => showToast(t('applications.request_failed'), { variant: 'error', target: 'detail' }));
  }, [account, t]);
  const actionSize = uiDensity.profileActionSize + spacing.lg;
  const MembershipIcon = favorite ? Trash : Plus;
  const actionWidth = actionSize + spacing.sm;
  const actions = [
    { key: 'copy', label: t(copied ? 'common.copied' : 'common.copy'), accessibilityLabel: t(copied ? 'common.copied' : 'applications.copy_address'), icon: copied
      ? <Check size={spacing.xl} color={c.text} strokeWidth={iconStrokeWidth.default}/>
      : <Copy size={spacing.xl} color={c.text} strokeWidth={iconStrokeWidth.default}/> },
    ...(onOpenExternal ? [{ key: 'browser' as const, label: t('applications.browser_short'), accessibilityLabel: t('applications.browser_open_default'),
      icon: <Global size={spacing.xl} color={c.text} /> }] : []),
    ...(!entry.local ? [{ key: 'share' as const, label: t('share.title'), icon: <Share size={spacing.xl} color={c.text} /> }] : []),
    { key: 'settings', label: t('applications.permissions_manage'), icon: <ShieldCheck size={spacing.xl} color={c.text} /> },
    { key: 'reload', label: t('applications.runtime_reload'), icon: <RotateCw size={spacing.xl} color={c.text} strokeWidth={iconStrokeWidth.default} /> },
    ...(account ? [{ key: 'favorite' as const, label: t(favorite ? 'applications.remove_app' : 'applications.add_app'), icon: <MembershipIcon size={spacing.xl} color={favorite ? c.danger : c.text} strokeWidth={iconStrokeWidth.default} /> }] : []),
  ] as const;
  return <HorizontalScrollView
    containerStyle={{ marginHorizontal: -spacing.lg }}
    contentContainerStyle={{ paddingHorizontal: spacing.lg - (actionWidth - actionSize) / 2, gap: spacing.xs, alignItems: 'flex-start' }}>
    {actions.map((action) => <ProfileAction key={action.key} shape="square" layout="fixed"
      width={actionWidth} size={actionSize}
      tone={action.key === 'favorite' && favorite ? 'danger' : 'default'}
      labelVariant="micro" icon={action.icon} label={action.label} accessibilityLabel={'accessibilityLabel' in action ? action.accessibilityLabel : action.label}
      onPress={() => { if (action.key === 'copy') void copyText(applicationCopyAddress(entry)); else if (action.key === 'favorite') void setFavorite(entry, !favorite); else if (action.key === 'browser') onOpenExternal?.(); else onAction(action.key); }} />)}
  </HorizontalScrollView>;
}

function DomainPermissions({ release, accountPubkey }: { release: NappletRelease; accountPubkey: string }) {
  const [saved, setSaved] = useState<string[]>();
  const [selected, setSelected] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const required = [...new Set(['shell', ...nappletAccessDomains(release.required)])];
  const optional = nappletAccessDomains(release.optional).filter((domain) => !required.includes(domain) && (NAP_DOMAINS as readonly string[]).includes(domain));
  useEffect(() => {
    let active = true;
    void nappletService.domainPermissions(release, accountPubkey).then((domains) => {
      if (active) {
        const selected = [...new Set(['shell', ...nappletAccessDomains(release.required), ...domains])];
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
